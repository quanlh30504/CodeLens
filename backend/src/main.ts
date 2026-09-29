import { loadConfig } from './config/app-config';
import { EnvSecretProvider } from './config/secret-provider';
import { createApp } from './app';
import { GithubAppClient } from './github/github-app.client';
import { checkAppPermissionsAtStartup } from './github/permission-check';
import { createLogger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { startMetricsReporter } from './observability/metrics-reporter';

/** Refuses to start on missing configuration or secrets, or a disallowed GitHub App permission. */
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

  const app = await createApp({ config, secrets });
  await app.listen(config.port, '0.0.0.0');
  startMetricsReporter(app.get(Metrics), logger);
  // Startup line: identifiers and settings only, never a secret value.
  logger.info({ port: config.port, nodeEnv: config.nodeEnv, githubAppId: config.githubAppId }, 'api listening');
}

main().catch((error: unknown) => {
  createLogger().error({ error: error instanceof Error ? error.message : 'unknown error' }, 'api failed to start');
  process.exitCode = 1;
});
