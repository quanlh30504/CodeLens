import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app';
import type { AppConfig } from '../../src/config/app-config';
import type { SecretProvider } from '../../src/config/secret-provider';
import { ReconcileProcessor } from '../../src/installations/reconcile.processor';
import { SyncProcessor } from '../../src/repositories/sync.processor';
import { WorkerRunner, type JobHandlers } from '../../src/queue/worker-runner';
import { createBullConnection } from '../../src/queue/redis';
import { createLogger } from '../../src/observability/logger';
import { TEST_WEBHOOK_SECRET } from '../fakes/webhook-fixtures';
import type { FakeGithub } from '../fakes/fake-github';

/**
 * Integration-test harness. Starts throwaway PostgreSQL and Redis containers and applies
 * the committed migrations. Tests never talk to a real GitHub or use real credentials:
 * everything GitHub-related goes through the fake in test/fakes/.
 */
export interface Infra {
  databaseUrl: string;
  redisUrl: string;
  prisma: PrismaClient;
  stop(): Promise<void>;
}

const backendRoot = path.resolve(__dirname, '..', '..');

export function applyMigrations(databaseUrl: string): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

export async function startInfra(options: { redis?: boolean } = {}): Promise<Infra> {
  const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('codelens_test')
    .withUsername('codelens')
    .withPassword('test-only-password')
    .start();
  const databaseUrl = postgres.getConnectionUri();
  applyMigrations(databaseUrl);

  let redis: StartedRedisContainer | undefined;
  if (options.redis !== false) {
    redis = await new RedisContainer('redis:7-alpine').start();
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await prisma.$connect();

  return {
    databaseUrl,
    redisUrl: redis ? redis.getConnectionUrl() : '',
    prisma,
    async stop() {
      await prisma.$disconnect();
      await redis?.stop();
      await postgres.stop();
    },
  };
}

/** Secrets for tests: generated or fixed test-only values, never real credentials. */
export function testSecrets(github: FakeGithub): SecretProvider {
  return {
    githubAppPrivateKey: () => github.privateKeyPem,
    githubClientSecret: () => 'test-only-client-secret',
    githubWebhookSecret: () => TEST_WEBHOOK_SECRET,
    sessionSecret: () => 'test-only-session-secret-0123456789',
    assertAllPresent: () => undefined,
  };
}

export function testConfig(infra: Infra, github: FakeGithub): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: infra.databaseUrl,
    redisUrl: infra.redisUrl,
    publicBaseUrl: 'http://localhost:8080',
    githubAppId: github.appId,
    githubAppClientId: 'test-client-id',
    githubAppSlug: 'codelens-test',
    githubApiBaseUrl: github.url,
    githubWebBaseUrl: github.url,
    queueBackoffMs: 50,
    logLevel: 'silent',
  };
}

/** Boots the API against the containers and the fake GitHub. */
export async function startApi(infra: Infra, github: FakeGithub): Promise<INestApplication> {
  process.env.DATABASE_URL = infra.databaseUrl;
  const app = await createApp({ config: testConfig(infra, github), secrets: testSecrets(github) });
  await app.init();
  return app;
}

/** Starts the queue consumers against the test Redis with the given handlers. */
export function startWorker(infra: Infra, handlers: JobHandlers): { stop(): Promise<void> } {
  const connection = createBullConnection(infra.redisUrl);
  const runner = new WorkerRunner(connection, createLogger({ level: 'silent' }));
  runner.start(handlers);
  return {
    async stop() {
      await runner.stop();
      connection.disconnect();
    },
  };
}

/** Starts the real queue consumers (reconcile and sync) using the services of a running test app. */
export function startAppWorker(app: INestApplication, infra: Infra): { stop(): Promise<void> } {
  const reconcile = app.get(ReconcileProcessor);
  const sync = app.get(SyncProcessor);
  return startWorker(infra, {
    reconcile: (data, jobId, info) => reconcile.handle(data, jobId, info),
    sync: (data, jobId, info) => sync.handle(data, jobId, info),
  });
}

/** Waits until `check` returns a truthy value, polling; used for asynchronous queue results. */
export async function eventually<T>(check: () => Promise<T | false | null | undefined>, timeoutMs = 20000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
