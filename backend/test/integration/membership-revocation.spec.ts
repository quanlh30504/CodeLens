import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { installAndSync, signInAs } from './support';

/** US6 scenario 3: access ends at the next confirmation with GitHub, and not before (FR-038). */
describe('membership revocation', () => {
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
  const installations = (cookie: string) => request(server()).get('/api/installations').set('Cookie', cookie);

  it('keeps access until the next confirmation, then removes it at sign-in', async () => {
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(2) });
    await installAndSync(world, 11, 500);
    const { session, id } = await installAndSync(world, 10, 500);

    // GitHub removes user 10 from the organization. CodeLens has not asked again yet.
    world.github.revokeAccess(10, 500);
    expect((await installations(session.cookie)).body.items).toHaveLength(1);

    // Next confirmation: signing in again.
    const again = await signInAs(world, 10);
    expect((await installations(again.cookie)).body.items).toEqual([]);
    await request(server()).get(`/api/installations/${id}`).set('Cookie', again.cookie).expect(404);

    // The other member is unaffected.
    const other = await signInAs(world, 11);
    expect((await installations(other.cookie)).body.items).toHaveLength(1);
  });

  it('removes access when the user chooses "Refresh access", and replaces the old session', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const { session } = await installAndSync(world, 10, 500);
    world.github.revokeAccess(10, 500);

    // GET /me/refresh-access sends the user through GitHub authorization again.
    const start = await request(server()).get('/api/me/refresh-access').set('Cookie', session.cookie).expect(302);
    const authorize = new URL(start.headers.location);
    expect(authorize.pathname).toBe('/login/oauth/authorize');
    const state = authorize.searchParams.get('state')!;
    const stateCookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    const callback = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: world.github.authCode(10), state })
      .set('Cookie', `${stateCookie}; ${session.cookie}`)
      .expect(302);
    const fresh = (callback.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).find((c) => c.startsWith('codelens_session='))!;

    expect(fresh).not.toBe(session.cookie);
    expect((await installations(fresh)).body.items).toEqual([]);
    // The old session no longer works.
    await request(server()).get('/api/me').set('Cookie', session.cookie).expect(401);
  });

  it('keeps existing memberships when GitHub cannot be asked (fail safe)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    await installAndSync(world, 10, 500);
    world.github.failNext(/\/user\/installations/, 503, 5);
    const session = await signInAs(world, 10); // sign-in itself still works
    expect((await installations(session.cookie)).body.items).toHaveLength(1);
  });

  it('keeps the memberships of an organization whose installations are all removed, so history stays visible', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const { session } = await installAndSync(world, 10, 500);
    await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'REMOVED', removedAt: new Date() } });
    world.github.removeInstallation(500);
    const again = await signInAs(world, 10);
    const list = await installations(again.cookie);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].displayState).toBe('REMOVED');
    expect(session.cookie).toBeTruthy();
  });
});
