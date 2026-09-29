import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from '../integration/scenario';
import { SignedIn, installAndSync, makeOwner, signInAs } from '../integration/support';
import { documentedStatuses, expectMatchesContract } from './openapi';

/** Management routes answer as documented (FR-016, FR-021). 503 needs role re-confirmation (T092). */
describe('management contract', () => {
  let world: World;
  let owner: SignedIn;
  let member: SignedIn;
  let installationId: string;
  let repoId: string;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(2) });
    const installed = await installAndSync(world, 10, 500);
    owner = installed.session;
    installationId = installed.id;
    member = await signInAs(world, 11);
    await makeOwner(world, owner);
    repoId = (await world.infra.prisma.repository.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await world.stop();
  });

  const server = () => world.app.getHttpServer();
  const put = (s: SignedIn, id: string, body: object = { enabled: true }) =>
    request(server()).put(`/api/repositories/${id}/review-enabled`).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrfToken).send(body);
  const post = (s: SignedIn, id: string) =>
    request(server()).post(`/api/installations/${id}/sync`).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrfToken);

  it('documents the statuses used here', () => {
    expect(documentedStatuses('/repositories/{repositoryId}/review-enabled', 'put')).toEqual(expect.arrayContaining(['200', '401', '403', '404', '409', '503']));
    expect(documentedStatuses('/installations/{installationId}/sync', 'post')).toEqual(expect.arrayContaining(['202', '401', '403', '404', '503']));
  });

  it('PUT review-enabled: 200, 403 (member), 403 REAUTH_REQUIRED, 404, 409', async () => {
    const ok = await put(owner, repoId).expect(200);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 200, ok.body);

    const forbidden = await put(member, repoId).expect(403);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 403, forbidden.body);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    await makeOwner(world, owner, 30);
    const stale = await put(owner, repoId).expect(403);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 403, stale.body);
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
    await makeOwner(world, owner, 0);

    const missing = await put(owner, '00000000-0000-4000-8000-000000000000').expect(404);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 404, missing.body);

    const second = (await world.infra.prisma.repository.findMany({ orderBy: { fullName: 'desc' } }))[0];
    await world.infra.prisma.repository.update({ where: { id: second.id }, data: { status: 'INACCESSIBLE' } });
    const conflict = await put(owner, second.id).expect(409);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 409, conflict.body);

    const unauthenticated = await request(server()).put(`/api/repositories/${repoId}/review-enabled`).send({ enabled: true }).expect(401);
    expectMatchesContract('/repositories/{repositoryId}/review-enabled', 'put', 401, unauthenticated.body);
  });

  it('POST sync: 202, 403, 404, 401', async () => {
    const accepted = await post(owner, installationId).expect(202);
    expectMatchesContract('/installations/{installationId}/sync', 'post', 202, accepted.body);
    const forbidden = await post(member, installationId).expect(403);
    expectMatchesContract('/installations/{installationId}/sync', 'post', 403, forbidden.body);
    const missing = await post(owner, '00000000-0000-4000-8000-000000000000').expect(404);
    expectMatchesContract('/installations/{installationId}/sync', 'post', 404, missing.body);
    const unauthenticated = await request(server()).post(`/api/installations/${installationId}/sync`).expect(401);
    expectMatchesContract('/installations/{installationId}/sync', 'post', 401, unauthenticated.body);
  });
});
