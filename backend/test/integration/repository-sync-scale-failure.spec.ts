import { ReconcileService } from '../../src/installations/reconcile.service';
import { QueueService } from '../../src/queue/queue.service';
import { SyncProcessor } from '../../src/repositories/sync.processor';
import { SyncService } from '../../src/repositories/sync.service';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { eventually } from './support';

/** FR-011 (limit), FR-017 (failure and retry), SC-003 (scale). */
describe('repository synchronization at scale and under failure', () => {
  let world: World;
  let sync: SyncService;
  let processor: SyncProcessor;
  let reconcile: ReconcileService;

  beforeAll(async () => {
    world = await startWorld();
    sync = world.app.get(SyncService);
    processor = world.app.get(SyncProcessor);
    reconcile = world.app.get(ReconcileService);
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
  });

  const install = () => reconcile.reconcile(500);
  const installation = () => world.infra.prisma.githubInstallation.findFirstOrThrow();
  const repositories = () => world.infra.prisma.repository.findMany({ orderBy: { githubRepositoryId: 'asc' } });
  const serialize = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

  it('synchronizes and lists 500 repositories in well under two minutes (SC-003)', async () => {
    seedInstallation(world.github, { repos: makeRepos(500) });
    await install();
    const started = Date.now();
    await sync.sync(500);
    expect(Date.now() - started).toBeLessThan(120_000);
    expect(await world.infra.prisma.repository.count()).toBe(500);
    expect((await installation()).syncStatus).toBe('SYNCED');
  });

  it('keeps stored data untouched and shows a reason category when a page fails after all retries (FR-017)', async () => {
    seedInstallation(world.github, { repos: makeRepos(250) });
    await install();
    await sync.sync(500);
    const before = serialize(await repositories());

    // The second page fails, so the whole read fails before anything is written.
    world.github.failNext(/installation\/repositories\?per_page=100&page=2/, 503, 50);
    world.github.installations.get(500)!.repos = makeRepos(120); // GitHub changed in the meantime
    await expect(processor.handle({ githubInstallationId: 500 }, 'job-1', { attempt: 5, maxAttempts: 5 })).rejects.toThrow();

    expect(serialize(await repositories())).toBe(before);
    const failed = await installation();
    expect(failed).toMatchObject({ syncStatus: 'FAILED', syncErrorCode: 'GITHUB_UNAVAILABLE' });
    expect(serialize(failed)).not.toMatch(/scripted|503/);
    const audits = await world.infra.prisma.auditLog.findMany({ where: { action: 'REPOSITORY_SYNC_FAILED' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ reason: 'GITHUB_UNAVAILABLE' });
  });

  it('does not show a failure while retries remain', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    await install();
    world.github.failNext(/installation\/repositories/, 503, 5);
    await expect(processor.handle({ githubInstallationId: 500 }, 'job-2', { attempt: 1, maxAttempts: 5 })).rejects.toThrow();
    const state = await installation();
    expect(state.syncStatus).toBe('SYNCING');
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'REPOSITORY_SYNC_FAILED' } })).toBe(0);
  });

  it('maps rate limiting and revoked access to their reason categories', async () => {
    seedInstallation(world.github, { repos: makeRepos(1) });
    await install();

    world.github.failNext(/installation\/repositories/, 403, 1, { 'x-ratelimit-remaining': '0' });
    await expect(processor.handle({ githubInstallationId: 500 }, 'j', { attempt: 5, maxAttempts: 5 })).rejects.toThrow();
    expect((await installation()).syncErrorCode).toBe('GITHUB_RATE_LIMITED');

    world.github.failNext(/installation\/repositories/, 401, 1);
    await expect(processor.handle({ githubInstallationId: 500 }, 'j', { attempt: 5, maxAttempts: 5 })).rejects.toThrow();
    expect((await installation()).syncErrorCode).toBe('ACCESS_REVOKED');
  });

  it('retries automatically at least three times with increasing delay, then succeeds without ever showing a failure (FR-017)', async () => {
    seedInstallation(world.github, { repos: makeRepos(4) });
    await install();
    world.startWorker();
    world.github.failNext(/installation\/repositories/, 503, 3);

    await world.app.get(QueueService).enqueueSync(500);
    await eventually(async () => (await installation()).syncStatus === 'SYNCED');

    expect(world.github.countRequests('GET', '/installation/repositories')).toBeGreaterThanOrEqual(4);
    expect(await world.infra.prisma.repository.count()).toBe(4);
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'REPOSITORY_SYNC_FAILED' } })).toBe(0);
  });

  it('shows failure only after the last retry, and a later retry by an owner succeeds', async () => {
    seedInstallation(world.github, { repos: makeRepos(4) });
    await install();
    world.startWorker();
    world.github.failNext(/installation\/repositories/, 503, 100);

    await world.app.get(QueueService).enqueueSync(500);
    await eventually(async () => (await installation()).syncStatus === 'FAILED');
    expect(await installation()).toMatchObject({ syncErrorCode: 'GITHUB_UNAVAILABLE' });
    expect(world.github.countRequests('GET', '/installation/repositories')).toBe(5);
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'REPOSITORY_SYNC_FAILED' } })).toBe(1);

    world.github.clearFailures();
    await processor.handle({ githubInstallationId: 500 }, 'retry', { attempt: 1, maxAttempts: 5 });
    expect(await installation()).toMatchObject({ syncStatus: 'SYNCED', syncErrorCode: null });
    expect(await world.infra.prisma.repository.count()).toBe(4);
  });

  it('synchronizes exactly the 5,000 lowest ids beyond the limit, the same set every run (FR-011)', async () => {
    // Ids are deliberately not in ascending order on GitHub's side.
    const all = makeRepos(5003, 'acme', 100_000).reverse();
    seedInstallation(world.github, { repos: all });
    await install();

    await sync.sync(500);
    let state = await installation();
    expect(state).toMatchObject({ syncStatus: 'SYNCED', syncErrorCode: 'REPOSITORY_LIMIT_EXCEEDED' });
    let stored = await repositories();
    expect(stored).toHaveLength(5000);
    expect(Number(stored[0].githubRepositoryId)).toBe(100_000);
    expect(Number(stored[4999].githubRepositoryId)).toBe(104_999);

    const snapshot = serialize(stored);
    await sync.sync(500);
    expect(serialize(await repositories())).toBe(snapshot);

    // A repository with a lower id appears: the highest previously included id drops out.
    world.github.installations.get(500)!.repos.push({ id: 99_999, name: 'newcomer', owner: 'acme' });
    await sync.sync(500);
    stored = await repositories();
    expect(stored.filter((r) => r.status === 'ACCESSIBLE')).toHaveLength(5000);
    const dropped = stored.find((r) => Number(r.githubRepositoryId) === 104_999)!;
    expect(dropped).toMatchObject({ status: 'INACCESSIBLE', reviewEnabled: false });
    expect(stored.find((r) => Number(r.githubRepositoryId) === 99_999)!.status).toBe('ACCESSIBLE');
    state = await installation();
    expect(state.syncErrorCode).toBe('REPOSITORY_LIMIT_EXCEEDED');
  });

  it('clears the limit warning once the installation is back under the limit', async () => {
    seedInstallation(world.github, { repos: makeRepos(5001) });
    await install();
    await sync.sync(500);
    expect((await installation()).syncErrorCode).toBe('REPOSITORY_LIMIT_EXCEEDED');
    world.github.installations.get(500)!.repos = makeRepos(10);
    await sync.sync(500);
    expect(await installation()).toMatchObject({ syncErrorCode: null, syncStatus: 'SYNCED' });
  });
});
