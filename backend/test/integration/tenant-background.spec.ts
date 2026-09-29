import { Writable } from 'node:stream';
import { QueueService } from '../../src/queue/queue.service';
import { createLogger } from '../../src/observability/logger';
import { ReconcileProcessor } from '../../src/installations/reconcile.processor';
import { SyncProcessor } from '../../src/repositories/sync.processor';
import { WorkerRunner } from '../../src/queue/worker-runner';
import { createBullConnection } from '../../src/queue/redis';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { eventually } from './support';

/** FR-009: background work is authorized by the installation and never crosses organizations. */
describe('tenant isolation in background work', () => {
  let world: World;

  beforeAll(async () => {
    world = await startWorld();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
  });

  const serialize = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

  it('writes only within the installation\'s organization when it synchronizes', async () => {
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', repos: makeRepos(3, 'acme', 100) });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', repos: makeRepos(3, 'globex', 200) });
    const reconcile = world.app.get(ReconcileProcessor);
    const sync = world.app.get(SyncProcessor);
    await reconcile.handle({ githubInstallationId: 500 });
    await reconcile.handle({ githubInstallationId: 600 });
    await sync.handle({ githubInstallationId: 600 }, 'j', { attempt: 1, maxAttempts: 5 });

    const globexBefore = serialize(await world.infra.prisma.repository.findMany({ where: { fullName: { startsWith: 'globex/' } } }));
    world.github.installations.get(500)!.repos = makeRepos(5, 'acme', 100);
    await sync.handle({ githubInstallationId: 500 }, 'j', { attempt: 1, maxAttempts: 5 });

    const acme = await world.infra.prisma.organization.findFirstOrThrow({ where: { login: 'acme' } });
    const acmeRepos = await world.infra.prisma.repository.findMany({ where: { fullName: { startsWith: 'acme/' } } });
    expect(acmeRepos).toHaveLength(5);
    expect(acmeRepos.every((r) => r.organizationId === acme.id)).toBe(true);
    // The other tenant's rows are byte-for-byte untouched.
    expect(serialize(await world.infra.prisma.repository.findMany({ where: { fullName: { startsWith: 'globex/' } } }))).toBe(globexBefore);
  });

  it('queue jobs carry only the GitHub installation id (and the delivery id), never tenant or user data', async () => {
    const connection = createBullConnection(world.infra.redisUrl);
    const queues = new QueueService(connection);
    await queues.enqueueSync(4242, 'delivery-x');
    const raw = await connection.hgetall('bull:sync-repositories:sync-4242');
    expect(JSON.parse(raw.data)).toEqual({ githubInstallationId: 4242, deliveryGuid: 'delivery-x' });
    await queues.close();
    connection.disconnect();
  });

  it('job logs name only their own installation', async () => {
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', repos: makeRepos(2, 'acme', 100) });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', repos: makeRepos(2, 'globex', 200) });
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const connection = createBullConnection(world.infra.redisUrl);
    const runner = new WorkerRunner(connection, createLogger({ level: 'info', destination: stream }));
    const reconcile = world.app.get(ReconcileProcessor);
    const sync = world.app.get(SyncProcessor);
    runner.start({
      reconcile: (d, j, i) => reconcile.handle(d, j, i),
      sync: (d, j, i) => sync.handle(d, j, i),
    });
    const queues = new QueueService(createBullConnection(world.infra.redisUrl));
    await queues.enqueueReconcile(500);
    await eventually(async () => (await world.infra.prisma.repository.count()) === 2);
    await queues.enqueueReconcile(600);
    await eventually(async () => (await world.infra.prisma.repository.count()) === 4);
    await runner.stop();
    await queues.close();
    connection.disconnect();

    const entries = lines.map((l) => JSON.parse(l) as { githubInstallationId?: number; jobId?: string; msg: string });
    const forAcme = entries.filter((e) => e.githubInstallationId === 500);
    const forGlobex = entries.filter((e) => e.githubInstallationId === 600);
    expect(forAcme.length).toBeGreaterThan(0);
    expect(forGlobex.length).toBeGreaterThan(0);
    const acmeText = JSON.stringify(forAcme);
    const globexText = JSON.stringify(forGlobex);
    expect(acmeText).not.toMatch(/600|globex/);
    expect(globexText).not.toMatch(/500|acme/);
    // Logs never carry repository names or account names at all.
    expect(lines.join('')).not.toMatch(/repo-000|acme\/|globex\//);
  });
});
