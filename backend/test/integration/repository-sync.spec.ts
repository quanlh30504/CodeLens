import { SyncService } from '../../src/repositories/sync.service';
import { ReconcileService } from '../../src/installations/reconcile.service';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';

/** FR-011 to FR-015, SC-006: synchronization is deterministic and safe to repeat. */
describe('repository synchronization', () => {
  let world: World;
  let sync: SyncService;
  let reconcile: ReconcileService;

  beforeAll(async () => {
    world = await startWorld();
    sync = world.app.get(SyncService);
    reconcile = world.app.get(ReconcileService);
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
  });

  const rows = () => world.infra.prisma.repository.findMany({ orderBy: { githubRepositoryId: 'asc' } });
  const serialize = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
  const install = async (installationId = 500) => {
    const { installation } = await reconcile.reconcile(installationId);
    return installation!;
  };

  it('creates repositories disabled and accessible with GitHub metadata (FR-011, FR-015)', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    await install();
    const outcome = await sync.sync(500);
    expect(outcome).toMatchObject({ status: 'SYNCED', created: 3 });
    const stored = await rows();
    expect(stored).toHaveLength(3);
    for (const r of stored) {
      expect(r).toMatchObject({ status: 'ACCESSIBLE', reviewEnabled: false, owner: 'acme', defaultBranch: 'main' });
    }
    const installation = await world.infra.prisma.githubInstallation.findFirstOrThrow();
    expect(installation).toMatchObject({ syncStatus: 'SYNCED', syncErrorCode: null });
    expect(installation.lastSyncedAt).not.toBeNull();
  });

  it('produces no change on ten consecutive runs against unchanged GitHub state (SC-006)', async () => {
    seedInstallation(world.github, { repos: makeRepos(20) });
    await install();
    await sync.sync(500);
    const snapshot = serialize(await rows());
    const auditBefore = await world.infra.prisma.auditLog.count();
    for (let i = 0; i < 10; i += 1) {
      const outcome = await sync.sync(500);
      expect(outcome).toMatchObject({ created: 0, updated: 0, markedInaccessible: 0, reassigned: 0 });
    }
    expect(serialize(await rows())).toBe(snapshot);
    expect(await world.infra.prisma.auditLog.count()).toBe(auditBefore);
  });

  it('updates a renamed repository in place, not as a new one (FR-014, US4 scenario 3)', async () => {
    const repos = makeRepos(2);
    seedInstallation(world.github, { repos });
    await install();
    await sync.sync(500);
    const before = (await rows())[0];

    world.github.installations.get(500)!.repos[0] = { ...repos[0], name: 'renamed' };
    await sync.sync(500);
    const after = await rows();
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: before.id, name: 'renamed', fullName: 'acme/renamed' });
  });

  it('handles two repositories swapping names and a deleted-then-recreated name', async () => {
    seedInstallation(world.github, {
      repos: [
        { id: 1, name: 'alpha', owner: 'acme' },
        { id: 2, name: 'beta', owner: 'acme' },
      ],
    });
    await install();
    await sync.sync(500);

    world.github.installations.get(500)!.repos = [
      { id: 1, name: 'beta', owner: 'acme' },
      { id: 2, name: 'alpha', owner: 'acme' },
    ];
    await sync.sync(500);
    expect((await rows()).map((r) => [Number(r.githubRepositoryId), r.fullName])).toEqual([
      [1, 'acme/beta'],
      [2, 'acme/alpha'],
    ]);

    // Repository 1 is deleted on GitHub and a new repository (id 3) takes its name.
    world.github.installations.get(500)!.repos = [
      { id: 2, name: 'alpha', owner: 'acme' },
      { id: 3, name: 'beta', owner: 'acme' },
    ];
    await sync.sync(500);
    const stored = await rows();
    expect(stored.find((r) => Number(r.githubRepositoryId) === 3)).toMatchObject({ fullName: 'acme/beta', status: 'ACCESSIBLE' });
    expect(stored.find((r) => Number(r.githubRepositoryId) === 1)).toMatchObject({ status: 'INACCESSIBLE', reviewEnabled: false });
  });

  it('updates visibility changes (Edge Case)', async () => {
    const repos = makeRepos(1);
    seedInstallation(world.github, { repos: [{ ...repos[0], private: true }] });
    await install();
    await sync.sync(500);
    expect((await rows())[0].private).toBe(true);
    world.github.installations.get(500)!.repos = [{ ...repos[0], private: false }];
    await sync.sync(500);
    expect((await rows())[0].private).toBe(false);
  });

  it('marks repositories GitHub stops reporting as inaccessible and disabled, keeping the row (FR-014)', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    await install();
    await sync.sync(500);
    const [first] = await rows();
    await world.infra.prisma.repository.update({ where: { id: first.id }, data: { reviewEnabled: true, enabledAt: new Date() } });

    world.github.installations.get(500)!.repos = makeRepos(3).slice(1);
    const outcome = await sync.sync(500);
    expect(outcome.markedInaccessible).toBe(1);
    const stored = await rows();
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({ id: first.id, status: 'INACCESSIBLE', reviewEnabled: false, enabledAt: null });
  });

  it('brings a returning repository back disabled, so it must be enabled again (FR-015)', async () => {
    seedInstallation(world.github, { repos: makeRepos(1) });
    await install();
    await sync.sync(500);
    const [repo] = await rows();
    await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: true } });

    const original = world.github.installations.get(500)!.repos;
    world.github.installations.get(500)!.repos = [];
    await sync.sync(500);
    expect((await rows())[0]).toMatchObject({ status: 'INACCESSIBLE', reviewEnabled: false });

    world.github.installations.get(500)!.repos = original;
    await sync.sync(500);
    expect((await rows())[0]).toMatchObject({ id: repo.id, status: 'ACCESSIBLE', reviewEnabled: false });
  });

  it('never synchronizes a suspended or removed installation (FR-024, FR-025)', async () => {
    seedInstallation(world.github, { repos: makeRepos(2) });
    await install();
    await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'SUSPENDED' } });
    expect((await sync.sync(500)).status).toBe('SKIPPED');
    await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'REMOVED' } });
    expect((await sync.sync(500)).status).toBe('SKIPPED');
    expect(await rows()).toHaveLength(0);
    expect((await sync.sync(123456)).status).toBe('SKIPPED');
  });

  it('moves a transferred repository to the new tenant, disabled and without the former settings (US4 scenario 8, FR-013)', async () => {
    const repo = { id: 77, name: 'moving', owner: 'acme' };
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', repos: [repo] });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', repos: [] });
    await install(500);
    await install(600);
    await sync.sync(500);
    const [stored] = await rows();
    await world.infra.prisma.repository.update({ where: { id: stored.id }, data: { reviewEnabled: true, enabledAt: new Date() } });

    // Transfer on GitHub: acme's installation loses it, globex's installation gains it.
    world.github.installations.get(500)!.repos = [];
    world.github.installations.get(600)!.repos = [{ ...repo, owner: 'globex' }];
    await sync.sync(600);

    const moved = (await rows())[0];
    const globex = await world.infra.prisma.organization.findFirstOrThrow({ where: { login: 'globex' } });
    expect(moved).toMatchObject({
      id: stored.id,
      organizationId: globex.id,
      fullName: 'globex/moving',
      status: 'ACCESSIBLE',
      reviewEnabled: false,
      enabledAt: null,
      enabledByUserId: null,
      syncConflict: false,
    });
  });

  it('lets the current holder keep a repository it still has access to, and flags it for operators only (research R7)', async () => {
    const repo = { id: 78, name: 'shared', owner: 'acme' };
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', repos: [repo] });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', repos: [{ ...repo }] });
    await install(500);
    await install(600);
    await sync.sync(500);
    const acme = await world.infra.prisma.organization.findFirstOrThrow({ where: { login: 'acme' } });

    await sync.sync(600);
    const stored = (await rows())[0];
    expect(stored).toMatchObject({ organizationId: acme.id, syncConflict: true });
  });
});
