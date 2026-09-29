import { FakeGithub } from './fake-github';

/**
 * Runs the fake GitHub as a standalone server for the `test` compose profile.
 * Keys are generated at start-up and printed nowhere; the API in that profile is given the
 * matching key through the shared volume file below.
 */
async function main(): Promise<void> {
  const port = Number(process.env.FAKE_GITHUB_PORT ?? 4010);
  const github = new FakeGithub();
  await github.start(port);
  const keyPath = process.env.FAKE_GITHUB_KEY_FILE;
  if (keyPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(keyPath, github.privateKeyPem, { mode: 0o400 });
  }
  process.stdout.write(`fake github listening on ${github.url} (app id ${github.appId})\n`);
}

void main();
