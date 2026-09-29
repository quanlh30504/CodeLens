import { startStack } from './support/stack';

/**
 * Starts the stack once for the whole run. Addresses and the run's throw-away secrets reach the
 * tests as environment variables of the worker processes; nothing is written to disk.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  process.env.E2E_BASE_URL = stack.baseUrl;
  process.env.E2E_POSTGRES_CONTAINER = stack.postgresContainer;
  process.env.E2E_WEBHOOK_SECRET = stack.webhookSecret;
  process.env.E2E_SECRETS = JSON.stringify(stack.secrets);
  process.env.E2E_CONTROL_PORT = String(stack.controlPort);
  process.env.E2E_FAKE_GITHUB_URL = stack.fakeGithubUrl;
  return async () => {
    await stack.stop();
  };
}
