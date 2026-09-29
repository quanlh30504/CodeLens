import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startProxy } from './proxy';

/**
 * Starts the whole product for the end-to-end run: PostgreSQL and Redis containers, the fake
 * GitHub, the API, the worker, the web app and a same-origin proxy. Every secret is generated
 * here at run time; nothing is a real credential and nothing is written into the repository.
 */
export interface Stack {
  baseUrl: string;
  controlPort: number;
  postgresContainer: string;
  webhookSecret: string;
  fakeGithubUrl: string;
  secrets: string[];
  stop(): Promise<void>;
}

const root = path.resolve(__dirname, '../../../..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const httpUp = (url: string) => () =>
  new Promise<boolean>((resolve) => {
    http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 600);
    }).on('error', () => resolve(false));
  });

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

export async function startStack(): Promise<Stack> {
  const suffix = randomBytes(4).toString('hex');
  const containers: string[] = [];
  const processes: ChildProcess[] = [];
  const tmp = mkdtempSync(path.join(tmpdir(), 'codelens-e2e-'));
  const [proxyPort, apiPort, webPort, fakePort, controlPort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
  const secrets = {
    postgres: randomBytes(12).toString('hex'),
    webhook: randomBytes(24).toString('hex'),
    session: randomBytes(32).toString('hex'),
    client: randomBytes(16).toString('hex'),
  };
  const baseUrl = `http://localhost:${proxyPort}`;

  const stop = async () => {
    for (const p of processes) p.kill('SIGTERM');
    for (const c of containers) {
      try {
        docker('rm', '-f', c);
      } catch {
        /* already gone */
      }
    }
    proxy?.close();
    rmSync(tmp, { recursive: true, force: true });
  };
  let proxy: http.Server | undefined;

  try {
    const pg = `codelens-e2e-pg-${suffix}`;
    const rd = `codelens-e2e-redis-${suffix}`;
    docker('run', '-d', '--rm', '--name', pg, '-e', 'POSTGRES_DB=codelens', '-e', 'POSTGRES_USER=codelens', '-e', `POSTGRES_PASSWORD=${secrets.postgres}`, '-p', '127.0.0.1::5432', 'postgres:16-alpine');
    containers.push(pg);
    docker('run', '-d', '--rm', '--name', rd, '-p', '127.0.0.1::6379', 'redis:7-alpine');
    containers.push(rd);
    const pgPort = docker('port', pg, '5432/tcp').split(':').pop()!;
    const redisPort = docker('port', rd, '6379/tcp').split(':').pop()!;
    await waitFor(async () => {
      docker('exec', pg, 'pg_isready', '-U', 'codelens', '-d', 'codelens');
      return true;
    }, 'PostgreSQL');
    await waitFor(async () => docker('exec', rd, 'redis-cli', 'ping') === 'PONG', 'Redis');

    const databaseUrl = `postgresql://codelens:${secrets.postgres}@127.0.0.1:${pgPort}/codelens`;
    const redisUrl = `redis://127.0.0.1:${redisPort}`;
    // Postgres restarts once during first boot; wait until a real connection works before migrating.
    await waitFor(async () => {
      execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
      return true;
    }, 'migrations', 90_000);

    const keyFile = path.join(tmp, 'app-key.pem');
    const run = (name: string, command: string, args: string[], cwd: string, env: Record<string, string>) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: process.env.E2E_DEBUG ? 'inherit' : 'ignore' });
      child.on('exit', (code) => {
        if (code && code !== 0 && code !== 143) console.error(`[e2e] ${name} exited with code ${code}`);
      });
      processes.push(child);
      return child;
    };

    run('fake-github', 'node', ['dist-fakes/test/fakes/serve.js'], backend, {
      FAKE_GITHUB_PORT: String(fakePort),
      FAKE_GITHUB_KEY_FILE: keyFile,
      FAKE_GITHUB_CONTROL_PORT: String(controlPort),
    });
    await waitFor(async () => existsSync(keyFile) && (await httpUp(`http://127.0.0.1:${fakePort}/x`)()), 'fake GitHub');
    const fakeGithubUrl = `http://127.0.0.1:${fakePort}`;

    const appEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      PUBLIC_BASE_URL: baseUrl,
      GITHUB_APP_ID: '424242',
      GITHUB_APP_CLIENT_ID: 'e2e-client-id',
      GITHUB_APP_SLUG: 'codelens-e2e',
      GITHUB_APP_CLIENT_SECRET: secrets.client,
      GITHUB_WEBHOOK_SECRET: secrets.webhook,
      SESSION_SECRET: secrets.session,
      GITHUB_APP_PRIVATE_KEY_FILE: keyFile,
      GITHUB_API_BASE_URL: fakeGithubUrl,
      GITHUB_WEB_BASE_URL: fakeGithubUrl,
      QUEUE_BACKOFF_MS: '100',
      LOG_LEVEL: process.env.E2E_DEBUG ? 'info' : 'warn',
    };
    run('api', 'node', ['dist/main.js'], backend, { ...appEnv, PORT: String(apiPort) });
    run('worker', 'node', ['dist/worker.js'], backend, appEnv);
    run('web', 'node_modules/.bin/next', ['start', '-p', String(webPort), '-H', '127.0.0.1'], frontend, {
      NODE_ENV: 'production',
      API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    });
    await waitFor(httpUp(`http://127.0.0.1:${apiPort}/api/me`), 'API', 90_000);
    await waitFor(httpUp(`http://127.0.0.1:${webPort}/sign-in`), 'web app', 90_000);
    proxy = await startProxy(proxyPort, apiPort, webPort);

    const response = await fetch(`http://127.0.0.1:${controlPort}/browser`, {
      method: 'POST',
      body: JSON.stringify({ setupUrl: `${baseUrl}/api/installations/callback` }),
    });
    if (!response.ok) throw new Error('could not configure the fake GitHub');

    return {
      baseUrl,
      controlPort,
      postgresContainer: pg,
      webhookSecret: secrets.webhook,
      fakeGithubUrl,
      secrets: [secrets.postgres, secrets.webhook, secrets.session, secrets.client],
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
