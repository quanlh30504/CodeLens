import request from 'supertest';
import { fixtures } from '../fakes/webhook-fixtures';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, eventually, installAndSync, makeOwner } from './support';
import { deliver } from './webhook-helpers';

/** US4 scenarios 1 to 3 and 8, and the repository edge cases (FR-013, FR-014). */
describe('repository changes reported by GitHub', () => {
  let world: World;
  let session: SignedIn;
  let installationId: string;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
    seedInstallation(world.github, { users: [10], repos: makeRepos(3) });
    const installed = await installAndSync(world, 10, 500);
    session = installed.session;
    installationId = installed.id;
  });

  const listRepos = async (cookie = session.cookie, id = installationId) =>
    (await request(world.app.getHttpServer()).get(`/api/installations/${id}/repositories`).set('Cookie', cookie)).body.items as {
      id: string;
      fullName: string;
      state: string;
      private: boolean;
    }[];
  const rows = () => world.infra.prisma.repository.findMany({ orderBy: { githubRepositoryId: 'asc' } });
  const github = () => world.github.installations.get(500)!;

  it('shows added repositories as disabled (scenario 1)', async () => {
    github().repos = makeRepos(5);
    await deliver(world.app, fixtures.installationRepositoriesAdded(500)).expect(202);
    const items = await eventually(async () => {
      const list = await listRepos();
      return list.length === 5 ? list : false;
    });
    expect(items.filter((r) => r.state === 'DISABLED')).toHaveLength(5);
  });

  it('marks removed repositories as no longer accessible and disabled, keeping their rows (scenario 2)', async () => {
    const [first] = await rows();
    await world.infra.prisma.repository.update({ where: { id: first.id }, data: { reviewEnabled: true, enabledAt: new Date() } });
    github().repos = makeRepos(3).slice(1);
    await deliver(world.app, fixtures.installationRepositoriesRemoved(500)).expect(202);

    await eventually(async () => (await rows())[0].status === 'INACCESSIBLE');
    const stored = await rows();
    expect(stored).toHaveLength(3); // the history stays
    expect(stored[0]).toMatchObject({ id: first.id, status: 'INACCESSIBLE', reviewEnabled: false });
    const listed = await listRepos();
    expect(listed.find((r) => r.id === first.id)?.state).toBe('INACCESSIBLE');
    expect(listed.filter((r) => r.state === 'DISABLED')).toHaveLength(2);
  });

  it('updates a renamed repository in the same row (scenario 3)', async () => {
    const [first] = await rows();
    github().repos[0] = { ...github().repos[0], name: 'brand-new-name' };
    await deliver(world.app, fixtures.repository(500, 'renamed')).expect(202);
    await eventually(async () => (await rows())[0].name === 'brand-new-name');
    const stored = await rows();
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({ id: first.id, fullName: 'acme/brand-new-name' });
  });

  it('updates visibility changes on the next synchronization', async () => {
    github().repos[0] = { ...github().repos[0], private: false };
    await deliver(world.app, fixtures.repository(500, 'publicized')).expect(202);
    await eventually(async () => (await rows())[0].private === false);
    github().repos[0] = { ...github().repos[0], private: true };
    await deliver(world.app, fixtures.repository(500, 'privatized')).expect(202);
    await eventually(async () => (await rows())[0].private === true);
  });

  it('marks a repository deleted on GitHub as inaccessible and disabled', async () => {
    const [first] = await rows();
    await world.infra.prisma.repository.update({ where: { id: first.id }, data: { reviewEnabled: true } });
    github().repos = github().repos.slice(1);
    await deliver(world.app, fixtures.repository(500, 'deleted')).expect(202);
    await eventually(async () => (await rows())[0].status === 'INACCESSIBLE');
    expect((await rows())[0]).toMatchObject({ reviewEnabled: false });
  });

  it('moves a transferred repository to the new owner\'s organization, disabled and cleared, and out of the old list (scenario 8)', async () => {
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', users: [20], repos: [] });
    const other = await installAndSync(world, 20, 600);
    const [moving] = await rows();
    await makeOwner(world, session);
    await world.infra.prisma.repository.update({ where: { id: moving.id }, data: { reviewEnabled: true, enabledAt: new Date(), enabledByUserId: session.userId } });

    // On GitHub the repository leaves acme's installation and joins globex's.
    const transferred = github().repos[0];
    github().repos = github().repos.slice(1);
    world.github.installations.get(600)!.repos = [{ ...transferred, owner: 'globex' }];
    await deliver(world.app, fixtures.repository(600, 'transferred')).expect(202);
    await eventually(async () => (await listRepos(other.session.cookie, other.id)).length === 1);

    const now = (await world.infra.prisma.repository.findUniqueOrThrow({ where: { id: moving.id } }));
    expect(now).toMatchObject({ reviewEnabled: false, enabledAt: null, enabledByUserId: null, fullName: `globex/${transferred.name}` });
    expect((await listRepos(other.session.cookie, other.id))[0]).toMatchObject({ id: moving.id, state: 'DISABLED' });
    // Gone from the former organization's list, and nothing of the new tenant shows there.
    const formerList = await listRepos();
    expect(formerList.map((r) => r.id)).not.toContain(moving.id);
    expect(JSON.stringify(formerList)).not.toContain('globex');
  });

  it('shows a repository transferred to an account without CodeLens as no longer accessible (Edge Case)', async () => {
    const [moving] = await rows();
    github().repos = github().repos.slice(1); // nobody else has CodeLens installed
    await deliver(world.app, fixtures.repository(500, 'transferred')).expect(202);
    await eventually(async () => (await listRepos()).find((r) => r.id === moving.id)?.state === 'INACCESSIBLE');
  });
});
