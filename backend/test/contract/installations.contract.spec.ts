import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from '../integration/scenario';
import { completeInstall, eventually, returnFromGithub, signInAs, startInstall } from '../integration/support';
import { documentedStatuses, expectMatchesContract } from './openapi';

/** Responses of the installation routes match contracts/api.openapi.yaml (FR-005, FR-018). */
describe('installations contract', () => {
  let world: World;
  let installationId: string;
  let cookie: string;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
    seedInstallation(world.github, { users: [10], repos: makeRepos(3) });
    const session = await signInAs(world, 10);
    cookie = session.cookie;
    const callback = await completeInstall(world.app, world.github, session, 10, 500);
    installationId = callback.headers.location.split('/').pop()!;
    await eventually(async () => {
      const r = await request(world.app.getHttpServer()).get(`/api/installations/${installationId}`).set('Cookie', cookie);
      return r.body.displayState === 'ACTIVE';
    });
  });

  afterAll(async () => {
    await world.stop();
  });

  const server = () => world.app.getHttpServer();

  it('documents every status this suite relies on', () => {
    expect(documentedStatuses('/installations/new', 'get')).toContain('302');
    expect(documentedStatuses('/installations/callback', 'get')).toEqual(expect.arrayContaining(['302', '400', '404']));
    expect(documentedStatuses('/installations', 'get')).toContain('200');
    expect(documentedStatuses('/installations/{installationId}', 'get')).toEqual(expect.arrayContaining(['200', '404']));
    expect(documentedStatuses('/installations/{installationId}/repositories', 'get')).toEqual(expect.arrayContaining(['200', '404']));
  });

  it('GET /installations', async () => {
    const response = await request(server()).get('/api/installations').set('Cookie', cookie).expect(200);
    expectMatchesContract('/installations', 'get', 200, response.body);
  });

  it('GET /installations/{installationId} for an existing and a missing installation', async () => {
    const ok = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', cookie).expect(200);
    expectMatchesContract('/installations/{installationId}', 'get', 200, ok.body);
    expect(ok.body).not.toHaveProperty('syncConflict');

    const missing = await request(server()).get('/api/installations/00000000-0000-4000-8000-000000000000').set('Cookie', cookie).expect(404);
    expectMatchesContract('/installations/{installationId}', 'get', 404, missing.body);
    const malformed = await request(server()).get('/api/installations/not-a-uuid').set('Cookie', cookie).expect(404);
    expect(malformed.body).toEqual(missing.body);
  });

  it('GET /installations/{installationId}/repositories', async () => {
    const ok = await request(server()).get(`/api/installations/${installationId}/repositories`).set('Cookie', cookie).expect(200);
    expectMatchesContract('/installations/{installationId}/repositories', 'get', 200, ok.body);
    for (const repository of ok.body.items) expect(repository).not.toHaveProperty('syncConflict');
    const missing = await request(server())
      .get('/api/installations/00000000-0000-4000-8000-000000000000/repositories')
      .set('Cookie', cookie)
      .expect(404);
    expectMatchesContract('/installations/{installationId}/repositories', 'get', 404, missing.body);
  });

  it('GET /installations/new and /installations/callback', async () => {
    const { state } = await startInstall(world.app, await signInAs(world, 10));
    expect(state).toBeTruthy();

    const session = await signInAs(world, 10);
    const bad = await returnFromGithub(world.app, session, { installation_id: 500, state: 'unknown', code: world.github.authCode(10) });
    expect(bad.status).toBe(400);
    expectMatchesContract('/installations/callback', 'get', 400, bad.body);

    world.github.addUser({ id: 99, login: 'stranger' });
    const stranger = await signInAs(world, 99);
    const notFound = await completeInstall(world.app, world.github, stranger, 99, 500);
    expect(notFound.status).toBe(404);
    expectMatchesContract('/installations/callback', 'get', 404, notFound.body);

    await request(server()).get('/api/installations').expect(401);
  });
});
