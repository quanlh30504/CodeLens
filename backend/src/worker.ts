import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';
import { EnvSecretProvider } from './config/secret-provider';
import { GithubAppClient } from './github/github-app.client';
import { checkAppPermissionsAtStartup } from './github/permission-check';
import { ReconcileProcessor } from './installations/reconcile.processor';
import { createLogger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { startMetricsReporter } from './observability/metrics-reporter';
import { createBullConnection } from './queue/redis';
import { WorkerRunner } from './queue/worker-runner';
import { SyncProcessor } from './repositories/sync.processor';

/**
 * Worker entry point (same image as the API). It refuses to start when configuration or secrets
 * are missing, or when the registered GitHub App holds a disallowed permission.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const secrets = new EnvSecretProvider();
  secrets.assertAllPresent();
  const logger = createLogger({ level: config.logLevel });

  const github = new GithubAppClient({
    appId: config.githubAppId,
    apiBaseUrl: config.githubApiBaseUrl,
    privateKey: () => secrets.githubAppPrivateKey(),
  });
  await checkAppPermissionsAtStartup(github);

  const context = await NestFactory.createApplicationContext(AppModule.forRoot({ config, secrets }), {
    logger: ['error', 'warn'],
  });
  context.enableShutdownHooks();

  const reconcile = context.get(ReconcileProcessor);
  const sync = context.get(SyncProcessor);
  const runner = new WorkerRunner(createBullConnection(config.redisUrl), logger);
  runner.start({
    reconcile: (data, jobId, info) => reconcile.handle(data, jobId, info),
    sync: (data, jobId, info) => sync.handle(data, jobId, info),
  });
  startMetricsReporter(context.get(Metrics), logger);
  logger.info({ nodeEnv: config.nodeEnv, githubAppId: config.githubAppId }, 'worker started');

  const shutdown = async () => {
    await runner.stop();
    await context.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  // Configuration and permission errors carry names only, never secret values.
  createLogger().error({ error: error instanceof Error ? error.message : 'unknown error' }, 'worker failed to start');
  process.exitCode = 1;
});
