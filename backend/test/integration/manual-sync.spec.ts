import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, eventually, installAndSync, makeOwner, signInAs } from './support';

/** FR-016, US3 scenario 10, US4 scenario 7: owner-only, safe to repeat. */
describe('manual synchronization', () => {
  let world: World;
  let owner: SignedIn;
  let installationId: string;

  beforeAll(async () => {
    world = await startWorld();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(2) });
    world.startWorker();
    const installed = await installAndSync(world, 10, 500);
    owner = installed.session;
    installationId = installed.id;
    await makeOwner(world, owner);
  });

  const server = () => world.app.getHttpServer();
  const post = (session: SignedIn | null, id = installationId) => {
    const req = request(server()).post(`/api/installations/${id}/sync`);
    return session ? req.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrfToken) : req;
  };

  it('refuses a MEMBER', async () => {
    const member = await signInAs(world, 11);
    const response = await post(member);
    expect(response.status).toBe(403);
  });

  it('refuses someone outside the organization exactly like a missing installation', async () => {
    const outsider = await signInAs(world, 12);
    const foreign = await post(outsider).expect(404);
    const missing = await post(outsider, '00000000-0000-4000-8000-000000000000').expect(404);
    expect(foreign.body).toEqual(missing.body);
    await post(null).expect(401);
  });

  it('repairs a missed event by re-reading GitHub', async () => {
    world.github.installations.get(500)!.repos = makeRepos(4);
    const response = await post(owner).expect(202);
    expect(['QUEUED', 'ALREADY_QUEUED']).toContain(response.body.status);
    await eventually(async () => (await world.infra.prisma.repository.count()) === 4);
  });

  it('collapses repeated requests into one waiting job', async () => {
    // Keep the queue consumer busy so requests pile up instead of running immediately.
    await world.worker?.stop();
    world.worker = null;
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await post(owner).expect(202)).body.status);
    expect(answers[0]).toBe('QUEUED');
    expect(answers.slice(1)).toEqual(['ALREADY_QUEUED', 'ALREADY_QUEUED', 'ALREADY_QUEUED', 'ALREADY_QUEUED']);
  });

  it('refuses when the installation is no longer active (409)', async () => {
    await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'REMOVED' } });
    const response = await post(owner).expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });
});
