import { fixtures } from '../fakes/webhook-fixtures';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { eventually } from './support';
import { deliver } from './webhook-helpers';

/** FR-030, US5 scenario 4: late and out-of-order events converge to GitHub's current state. */
describe('webhook ordering', () => {
  let world: World;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
  });

  const repos = () => world.infra.prisma.repository.findMany({ orderBy: { fullName: 'asc' } });
  const allProcessed = () =>
    eventually(async () => (await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } })) === 0);

  it('converges when the repositories event arrives before the installation event', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    await deliver(world.app, fixtures.installationRepositoriesAdded(500)).expect(202);
    await allProcessed();
    // CodeLens has not seen the installation yet, so nothing can be stored from that event.
    expect(await repos()).toHaveLength(0);

    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await eventually(async () => (await repos()).length === 3);
    expect((await world.infra.prisma.githubInstallation.findFirstOrThrow()).status).toBe('ACTIVE');
  });

  it('ends without an installation when "deleted" arrives before "created" for an installation GitHub no longer has', async () => {
    // GitHub's current state: the installation is gone.
    await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await allProcessed();
    expect(await world.infra.prisma.githubInstallation.count()).toBe(0);
    expect(await world.infra.prisma.organization.count()).toBe(0);
    expect(await world.infra.prisma.auditLog.count()).toBe(0);
  });

  it('ends removed when a late "created" arrives after the installation was deleted', async () => {
    seedInstallation(world.github, { repos: makeRepos(2) });
    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await eventually(async () => (await repos()).length === 2);

    world.github.removeInstallation(500);
    await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
    await eventually(async () => (await world.infra.prisma.githubInstallation.findFirstOrThrow()).status === 'REMOVED');

    // A late duplicate of the original creation (new delivery id) must not resurrect it.
    await deliver(world.app, fixtures.installationCreated(500, 1000, 'acme', 'late-created')).expect(202);
    await allProcessed();
    const installation = await world.infra.prisma.githubInstallation.findFirstOrThrow();
    expect(installation.status).toBe('REMOVED');
    expect((await repos()).every((r) => r.status === 'INACCESSIBLE' && !r.reviewEnabled)).toBe(true);
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'GITHUB_INSTALLATION_REMOVED' } })).toBe(1);
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'GITHUB_INSTALLATION_ADDED' } })).toBe(1);
  });

  it('applies the latest GitHub state when a suspend event is followed by an unsuspend that GitHub already made', async () => {
    seedInstallation(world.github, { repos: makeRepos(1) });
    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await eventually(async () => (await repos()).length === 1);

    // Events arrive suspend, unsuspend, but GitHub's state is "suspended" now (they were reordered).
    world.github.installations.get(500)!.suspended = true;
    await deliver(world.app, fixtures.installationUnsuspended(500)).expect(202);
    await deliver(world.app, fixtures.installationSuspended(500)).expect(202);
    await allProcessed();
    expect((await world.infra.prisma.githubInstallation.findFirstOrThrow()).status).toBe('SUSPENDED');
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'GITHUB_INSTALLATION_SUSPENDED' } })).toBe(1);
  });

  it('picks up repository changes that happen while a synchronization is running', async () => {
    seedInstallation(world.github, { repos: makeRepos(2) });
    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await eventually(async () => (await repos()).length === 2);

    world.github.latencies = [{ match: /installation\/repositories/, ms: 800 }];
    const installation = world.github.installations.get(500)!;
    await deliver(world.app, fixtures.repository(500, 'renamed')).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 200)); // the first sync is now running
    installation.repos = makeRepos(2).map((r, i) => (i === 0 ? { ...r, name: 'renamed-during-sync' } : r)).concat(makeRepos(1, 'acme', 9500));
    await deliver(world.app, fixtures.installationRepositoriesAdded(500)).expect(202);

    await eventually(async () => (await repos()).length === 3 && (await repos()).some((r) => r.name === 'renamed-during-sync'));
    world.github.clearFailures();
  });
});
