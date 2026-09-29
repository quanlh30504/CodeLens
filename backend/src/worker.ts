import 'reflect-metadata';
import { loadConfig } from './config/app-config';
import { EnvSecretProvider } from './config/secret-provider';
import { GithubAppClient } from './github/github-app.client';
import { checkAppPermissionsAtStartup } from './github/permission-check';
import { createLogger } from './observability/logger';

/**
 * Worker entry point (same image as the API). It refuses to start when configuration or
 * secrets are missing, or when the registered GitHub App holds a disallowed permission.
 * The job handlers are registered here as the reconcile and sync features are implemented.
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

  logger.info('worker configuration and permissions verified');
  logger.error('no job handlers are registered yet; refusing to start');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Configuration and permission errors carry names only, never secret values.
  createLogger().error({ error: error instanceof Error ? error.message : 'unknown error' }, 'worker failed to start');
  process.exitCode = 1;
});
