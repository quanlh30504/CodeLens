import { Writable } from 'node:stream';
import request from 'supertest';
import { REDIS } from '../../src/auth/auth.module';
import { setLogger } from '../../src/observability/app-logger';
import { createLogger } from '../../src/observability/logger';
import { fixtures, sign } from '../fakes/webhook-fixtures';
import { testSecrets } from './harness';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, completeInstall, eventually, makeOwner, signInAs } from './support';
import { deliver } from './webhook-helpers';

/**
 * SC-010: no secret value (private key, webhook secret, client secret, session secret, GitHub
 * credentials) appears in any response, header, log line, stored row, session, or queued job
 * during a run through every part of the feature.
 */
describe('secret leak scan', () => {
  let world: World;
  const logs: string[] = [];
  const seen: string[] = [];

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
    const stream = new Writable({
      write(chunk, _e, cb) {
        logs.push(chunk.toString());
        cb();
      },
    });
    setLogger(createLogger({ level: 'trace', destination: stream }));
  });

  afterAll(async () => {
    setLogger(createLogger({ level: 'silent' }));
    await world.stop();
  });

  const record = (r: request.Response) => {
    seen.push(JSON.stringify(r.body ?? {}), r.text ?? '');
    for (const [name, value] of Object.entries(r.headers)) {
      if (name === 'set-cookie') {
        // The httpOnly cookie value is an opaque identifier; only its attributes are inspected here.
        seen.push(...(value as unknown as string[]).map((c) => c.split(';').slice(1).join(';')));
      } else {
        seen.push(`${name}: ${String(value)}`);
      }
    }
    return r;
  };

  it('finds no secret anywhere after a complete run', async () => {
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(3) });
    const server = world.app.getHttpServer();

    // Sign-in, install and synchronization.
    const start = record(await request(server).get('/api/auth/github/login'));
    void start;
    const alice: SignedIn = await signInAs(world, 10);
    const callback = record(await completeInstall(world.app, world.github, alice, 10, 500));
    const installationId = String(callback.headers.location).split('/').pop()!;
    await eventually(async () => (await request(server).get(`/api/installations/${installationId}`).set('Cookie', alice.cookie)).body.displayState === 'ACTIVE');

    // Reads, management and sign-out.
    await makeOwner(world, alice);
    record(await request(server).get('/api/me').set('Cookie', alice.cookie));
    record(await request(server).get('/api/installations').set('Cookie', alice.cookie));
    const repos = record(await request(server).get(`/api/installations/${installationId}/repositories`).set('Cookie', alice.cookie));
    const repoId = repos.body.items[0].id;
    record(await request(server).put(`/api/repositories/${repoId}/review-enabled`).set('Cookie', alice.cookie).set('X-CSRF-Token', alice.csrfToken).send({ enabled: true }));
    record(await request(server).post(`/api/installations/${installationId}/sync`).set('Cookie', alice.cookie).set('X-CSRF-Token', alice.csrfToken));

    // Webhooks: accepted, repeated, rejected, malformed.
    const created = fixtures.installationCreated(500);
    record(await deliver(world.app, created));
    record(await deliver(world.app, created));
    record(await deliver(world.app, created, { headers: { 'x-hub-signature-256': sign(created.body, 'wrong') } }));
    record(await deliver(world.app, fixtures.ping(), { headers: { 'x-github-event': undefined } }));

    // A failing synchronization and a forbidden request.
    world.github.failNext(/installation\/repositories/, 503, 100);
    await request(server).post(`/api/installations/${installationId}/sync`).set('Cookie', alice.cookie).set('X-CSRF-Token', alice.csrfToken);
    await eventually(async () => (await world.infra.prisma.githubInstallation.findFirstOrThrow()).syncStatus === 'FAILED');
    world.github.clearFailures();
    const member = await signInAs(world, 11);
    record(await request(server).put(`/api/repositories/${repoId}/review-enabled`).set('Cookie', member.cookie).set('X-CSRF-Token', member.csrfToken).send({ enabled: false }));
    record(await request(server).post('/api/auth/logout').set('Cookie', alice.cookie).set('X-CSRF-Token', alice.csrfToken));

    // Everything at rest: every table, every Redis key, every queued job.
    const tables = ['users', 'organizations', 'organization_members', 'github_installations', 'repositories', 'webhook_deliveries', 'audit_logs'];
    const rows: string[] = [];
    for (const table of tables) {
      rows.push(JSON.stringify(await world.infra.prisma.$queryRawUnsafe(`SELECT * FROM ${table}`), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    }
    const redis = world.app.get<import('ioredis').default>(REDIS);
    const redisDump: string[] = [];
    for (const key of await redis.keys('*')) {
      const type = await redis.type(key);
      if (type === 'string') redisDump.push(key, String(await redis.get(key)));
      if (type === 'hash') redisDump.push(key, JSON.stringify(await redis.hgetall(key)));
    }

    const secrets = testSecrets(world.github);
    const forbidden = [
      secrets.githubClientSecret(),
      secrets.sessionSecret(),
      secrets.githubWebhookSecret(),
      secrets.githubAppPrivateKey().split('\n')[1] ?? 'PRIVATE',
      'PRIVATE KEY',
      'ghu_fake_',
      'ghs_fake_',
    ];
    const buckets: Record<string, string> = {
      'responses and headers': seen.join('\n'),
      logs: logs.join(''),
      'database rows': rows.join('\n'),
      'redis (sessions, states, jobs)': redisDump.join('\n'),
    };
    for (const [where, text] of Object.entries(buckets)) {
      for (const secret of forbidden) {
        expect({ where, leaked: text.includes(secret) ? secret.slice(0, 6) : null }).toEqual({ where, leaked: null });
      }
      // No GitHub App JWT (three base64url parts starting with the header of an RS256 token).
      expect({ where, jwt: /eyJhbGciOiJSUzI1NiI[\w-]+\.[\w-]+\.[\w-]+/.test(text) }).toEqual({ where, jwt: false });
    }
    expect(logs.length).toBeGreaterThan(0);
  }, 120_000);

  it('a request that fails does not echo secrets back in the error', async () => {
    const response = await request(world.app.getHttpServer()).post('/api/webhooks/github').set('x-hub-signature-256', 'sha256=' + 'a'.repeat(64)).send('{}');
    expect(response.status).toBe(401);
    expect(JSON.stringify([response.body, response.headers])).not.toContain(testSecrets(world.github).githubWebhookSecret());
  });
});
