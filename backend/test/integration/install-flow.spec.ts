import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { completeInstall, eventually, signInAs } from './support';

/** US2 scenarios 1 to 6, SC-002 (FR-005 to FR-011, FR-018). */
describe('install the GitHub App and see the installation', () => {
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

  const server = () => world.app.getHttpServer();

  it('sends the user to GitHub\'s own installation page (scenario 1)', async () => {
    world.github.addUser({ id: 10, login: 'ada' });
    const session = await signInAs(world, 10);
    const response = await request(server()).get('/api/installations/new').set('Cookie', session.cookie).expect(302);
    const location = new URL(response.headers.location);
    expect(location.pathname).toBe('/apps/codelens-test/installations/new');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('records the installation, its organization and exactly the selected repositories, all disabled (scenarios 2 and 3)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(3) });
    const session = await signInAs(world, 10);

    const started = Date.now();
    const callback = await completeInstall(world.app, world.github, session, 10, 500);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/^\/installations\/[0-9a-f-]{36}$/);
    const installationId = callback.headers.location.split('/').pop()!;

    // The installing user sees the installation right after the callback (scenario 2).
    const list = await request(server()).get('/api/installations').set('Cookie', session.cookie).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: installationId,
      organization: { login: 'acme', accountType: 'ORGANIZATION' },
      repositorySelection: 'SELECTED',
    });
    expect(['SETTING_UP', 'ACTIVE']).toContain(list.body.items[0].displayState);

    const repos = await eventually(async () => {
      const r = await request(server()).get(`/api/installations/${installationId}/repositories`).set('Cookie', session.cookie);
      return r.body.items?.length === 3 ? r.body : false;
    });
    expect(repos.items.map((r: { fullName: string }) => r.fullName).sort()).toEqual(
      ['acme/repo-0001', 'acme/repo-0002', 'acme/repo-0003'],
    );
    expect(repos.items.every((r: { state: string }) => r.state === 'DISABLED')).toBe(true);

    const detail = await eventually(async () => {
      const r = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie);
      return r.body.displayState === 'ACTIVE' ? r.body : false;
    });
    expect(detail.repositoryCount).toBe(3);
    // SC-002: visible within 30 seconds of GitHub completing the installation.
    expect(Date.now() - started).toBeLessThan(30_000);

    // Exactly one audit entry for the addition (FR-027).
    const audits = await world.infra.prisma.auditLog.findMany({ where: { action: 'GITHUB_INSTALLATION_ADDED' } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata)).not.toMatch(/token|secret/i);
  });

  it('lists every repository for an "all repositories" installation (scenario 4)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(7), selection: 'all' });
    const session = await signInAs(world, 10);
    const callback = await completeInstall(world.app, world.github, session, 10, 500);
    const installationId = callback.headers.location.split('/').pop()!;

    const detail = await eventually(async () => {
      const r = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie);
      return r.body.displayState === 'ACTIVE' ? r.body : false;
    });
    expect(detail).toMatchObject({ repositorySelection: 'ALL', repositoryCount: 7 });
  });

  it('shows an installation with no repositories as an empty list, not an error', async () => {
    seedInstallation(world.github, { users: [10], repos: [] });
    const session = await signInAs(world, 10);
    const callback = await completeInstall(world.app, world.github, session, 10, 500);
    const installationId = callback.headers.location.split('/').pop()!;

    const detail = await eventually(async () => {
      const r = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie);
      return r.body.displayState === 'ACTIVE' ? r.body : false;
    });
    expect(detail.repositoryCount).toBe(0);
    const repos = await request(server()).get(`/api/installations/${installationId}/repositories`).set('Cookie', session.cookie).expect(200);
    expect(repos.body).toEqual({ items: [], nextCursor: null });
  });

  it('shows nothing when the user abandons the GitHub flow (scenario 6)', async () => {
    world.github.addUser({ id: 10, login: 'ada' });
    const session = await signInAs(world, 10);
    await request(server()).get('/api/installations/new').set('Cookie', session.cookie).expect(302);
    const list = await request(server()).get('/api/installations').set('Cookie', session.cookie).expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('shows the same installation to another member of the organization after they sign in', async () => {
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(2) });
    const first = await signInAs(world, 10);
    await completeInstall(world.app, world.github, first, 10, 500);
    const second = await signInAs(world, 11);
    const list = await request(server()).get('/api/installations').set('Cookie', second.cookie).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].canManage).toBe(false);
  });

  it('searches, filters and pages the repository list', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(12) });
    const session = await signInAs(world, 10);
    const callback = await completeInstall(world.app, world.github, session, 10, 500);
    const installationId = callback.headers.location.split('/').pop()!;
    await eventually(async () => {
      const r = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie);
      return r.body.displayState === 'ACTIVE';
    });

    const page1 = await request(server()).get(`/api/installations/${installationId}/repositories?limit=5`).set('Cookie', session.cookie).expect(200);
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(server())
      .get(`/api/installations/${installationId}/repositories?limit=5&cursor=${page1.body.nextCursor}`)
      .set('Cookie', session.cookie)
      .expect(200);
    const ids = [...page1.body.items, ...page2.body.items].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(10);

    const search = await request(server()).get(`/api/installations/${installationId}/repositories?q=REPO-0007`).set('Cookie', session.cookie).expect(200);
    expect(search.body.items.map((r: { fullName: string }) => r.fullName)).toEqual(['acme/repo-0007']);
    const enabled = await request(server()).get(`/api/installations/${installationId}/repositories?state=ENABLED`).set('Cookie', session.cookie).expect(200);
    expect(enabled.body.items).toEqual([]);
    await request(server()).get(`/api/installations/${installationId}/repositories?limit=1000`).set('Cookie', session.cookie).expect(400);
    await request(server()).get(`/api/installations/${installationId}/repositories?state=WHATEVER`).set('Cookie', session.cookie).expect(400);
  });
});
