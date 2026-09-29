import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FakeGithub } from '../fakes/fake-github';

/**
 * SC-014 at process level: the compiled API and worker refuse to start when the registered GitHub
 * App holds a permission that is not read-only or not in the allow-list. The check runs before
 * any database or queue connection is made. Needs `pnpm build` (CI builds before testing).
 */
const backend = path.resolve(__dirname, '../..');
const built = existsSync(path.join(backend, 'dist/main.js')) && existsSync(path.join(backend, 'dist/worker.js'));

(built ? describe : describe.skip)('startup permission refusal', () => {
  let github: FakeGithub;

  beforeAll(async () => {
    github = await new FakeGithub().start();
  });

  afterAll(async () => {
    await github.stop();
  });

  /** Runs the compiled entry point asynchronously, so the in-process fake GitHub can answer it. */
  function run(entry: string, env: Record<string, string | undefined>): Promise<{ status: number | null; output: string }> {
    return new Promise((resolve) => {
      const child = spawn('node', [`dist/${entry}.js`], { cwd: backend, env: { PATH: process.env.PATH, ...env } });
      let output = '';
      child.stdout.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr.on('data', (d: Buffer) => (output += d.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, output });
      });
    });
  }

  function start(entry: 'main' | 'worker') {
    return run(entry, {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
        REDIS_URL: 'redis://127.0.0.1:1',
        PUBLIC_BASE_URL: 'http://localhost:8080',
        GITHUB_APP_ID: github.appId,
        GITHUB_APP_CLIENT_ID: 'x',
        GITHUB_APP_SLUG: 'x',
        GITHUB_API_BASE_URL: github.url,
        GITHUB_WEB_BASE_URL: github.url,
        GITHUB_APP_CLIENT_SECRET: 'test-only-client-secret',
        GITHUB_WEBHOOK_SECRET: 'test-only-webhook-secret',
        SESSION_SECRET: 'test-only-session-secret',
        GITHUB_APP_PRIVATE_KEY: github.privateKeyPem,
        LOG_LEVEL: 'info',
    });
  }

  it.each(['main', 'worker'] as const)('%s refuses to start when the app has a write permission and names it', async (entry) => {
    github.appPermissions = { metadata: 'read', pull_requests: 'write' };
    const result = await start(entry);
    const output = result.output;
    expect(result.status).toBe(1);
    expect(output).toContain('pull_requests:write');
    expect(output).not.toMatch(/PRIVATE KEY|test-only-/);
  });

  it.each(['main', 'worker'] as const)('%s refuses a read permission that is not in the allow-list', async (entry) => {
    github.appPermissions = { metadata: 'read', contents: 'read' };
    const result = await start(entry);
    expect(result.status).toBe(1);
    expect(result.output).toContain('contents:read (not in the allow-list)');
  });

  it('refuses to start when a secret is missing, naming only the secret', async () => {
    const result = await run('main', {
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      REDIS_URL: 'redis://127.0.0.1:1',
      PUBLIC_BASE_URL: 'http://localhost:8080',
      GITHUB_APP_ID: '1',
      GITHUB_APP_CLIENT_ID: 'x',
      GITHUB_APP_SLUG: 'x',
    });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/Missing secrets: .*GITHUB_APP_PRIVATE_KEY/);
  });
});
