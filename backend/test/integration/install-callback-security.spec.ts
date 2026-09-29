import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { completeInstall, returnFromGithub, signInAs, startInstall } from './support';

/** FR-005, FR-009, US2 scenarios 7 and 8: nothing is linked until GitHub confirms access. */
describe('install callback security', () => {
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

  const server = () => world.app.getHttpServer();
  const counts = async () => ({
    installations: await world.infra.prisma.githubInstallation.count(),
    organizations: await world.infra.prisma.organization.count(),
    memberships: await world.infra.prisma.organizationMember.count(),
  });

  it('rejects a state that is missing, unknown, reused, or belongs to another session (400)', async () => {
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(1) });
    const alice = await signInAs(world, 10);
    const bob = await signInAs(world, 11);

    const missing = await returnFromGithub(world.app, alice, { installation_id: 500, code: world.github.authCode(10), state: '' });
    expect(missing.status).toBe(400);
    const unknown = await returnFromGithub(world.app, alice, { installation_id: 500, code: world.github.authCode(10), state: 'nope' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('INVALID_STATE');

    // A state started in Alice's session cannot be used from Bob's.
    const { state } = await startInstall(world.app, alice);
    const foreign = await returnFromGithub(world.app, bob, { installation_id: 500, code: world.github.authCode(11), state });
    expect(foreign.status).toBe(400);

    // ...and is single-use: Alice cannot use it afterwards either, because it was consumed.
    const reused = await returnFromGithub(world.app, alice, { installation_id: 500, code: world.github.authCode(10), state });
    expect(reused.status).toBe(400);
    expect(await counts()).toEqual({ installations: 0, organizations: 0, memberships: 0 });
  });

  it('rejects an expired state (400)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const alice = await signInAs(world, 10);
    const { state } = await startInstall(world.app, alice);
    // The store drops the state at the end of its 10 minutes.
    const redis = world.app.get<import('ioredis').default>((await import('../../src/auth/auth.module')).REDIS);
    await redis.del(...(await redis.keys('oauth-state:*')));
    const response = await returnFromGithub(world.app, alice, { installation_id: 500, code: world.github.authCode(10), state });
    expect(response.status).toBe(400);
    expect(await counts()).toEqual({ installations: 0, organizations: 0, memberships: 0 });
  });

  it('answers 404 and links nothing for an installation GitHub does not list for this user, revealing nothing', async () => {
    // Installation 500 exists but only user 11 can access it.
    seedInstallation(world.github, { users: [11], repos: makeRepos(1) });
    world.github.addUser({ id: 10, login: 'mallory' });
    const mallory = await signInAs(world, 10);

    const forbidden = await completeInstall(world.app, world.github, mallory, 10, 500);
    const missing = await completeInstall(world.app, world.github, mallory, 10, 999999);
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // Identical answer whether the installation exists or not (FR-020).
    expect(forbidden.body).toEqual(missing.body);
    expect(await counts()).toEqual({ installations: 0, organizations: 0, memberships: 0 });
  });

  it('links nothing until the user confirms with GitHub when no code comes back, then links after confirmation (scenario 8)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const session = await signInAs(world, 10);
    const { state } = await startInstall(world.app, session);

    // Return without a code: the user is sent through GitHub authorization, nothing is linked yet.
    const first = await returnFromGithub(world.app, session, { installation_id: 500, state });
    expect(first.status).toBe(302);
    const authorize = new URL(first.headers.location);
    expect(authorize.pathname).toBe('/login/oauth/authorize');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/installations/callback');
    expect(await counts()).toEqual({ installations: 0, organizations: 0, memberships: 0 });

    // GitHub returns with a code and the new state, without the installation id.
    const resumed = await returnFromGithub(world.app, session, {
      state: authorize.searchParams.get('state')!,
      code: world.github.authCode(10),
    });
    expect(resumed.status).toBe(302);
    expect(resumed.headers.location).toMatch(/^\/installations\/[0-9a-f-]{36}$/);
    expect((await counts()).installations).toBe(1);
  });

  it('links nothing when the user declines authorization (scenario 8)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const session = await signInAs(world, 10);
    const { state } = await startInstall(world.app, session);
    const first = await returnFromGithub(world.app, session, { installation_id: 500, state });
    const confirmState = new URL(first.headers.location).searchParams.get('state')!;

    const declined = await returnFromGithub(world.app, session, { state: confirmState, error: 'access_denied' });
    expect(declined.status).toBe(302);
    expect(declined.headers.location).toBe('/installations?notice=not_confirmed');
    expect(await counts()).toEqual({ installations: 0, organizations: 0, memberships: 0 });
  });

  it('rejects an invalid installation id', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    const session = await signInAs(world, 10);
    const { state } = await startInstall(world.app, session);
    const response = await returnFromGithub(world.app, session, { installation_id: 'abc', state, code: world.github.authCode(10) });
    expect(response.status).toBe(400);
  });

  it('requires a signed-in session for both install routes', async () => {
    await request(server()).get('/api/installations/new').expect(401);
    await request(server()).get('/api/installations/callback').query({ state: 'x', installation_id: 1 }).expect(401);
  });

  it('does not leak the user credential or the installation token into responses', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(2) });
    const session = await signInAs(world, 10);
    const response = await completeInstall(world.app, world.github, session, 10, 500);
    const everything = JSON.stringify([response.headers, response.body, response.text]);
    expect(everything).not.toMatch(/ghu_fake_|ghs_fake_|test-only/);
  });
});
