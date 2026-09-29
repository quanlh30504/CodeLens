import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, installAndSync, makeOwner, signInAs } from './support';

/** US3 scenarios 1 to 4 and 9 (FR-015, FR-021, FR-023, FR-040). */
describe('enable and disable repositories', () => {
  let world: World;
  let owner: SignedIn;
  let installationId: string;
  let repoIds: string[];

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(3) });
    const installed = await installAndSync(world, 10, 500);
    owner = installed.session;
    installationId = installed.id;
    await makeOwner(world, owner);
    repoIds = (await world.infra.prisma.repository.findMany({ orderBy: { fullName: 'asc' } })).map((r) => r.id);
  });

  const server = () => world.app.getHttpServer();
  const put = (session: SignedIn, id: string, body: unknown) =>
    request(server()).put(`/api/repositories/${id}/review-enabled`).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrfToken).send(body as object);
  const state = async (id: string) => (await world.infra.prisma.repository.findUniqueOrThrow({ where: { id } })).reviewEnabled;
  const audits = (action: string) => world.infra.prisma.auditLog.findMany({ where: { action } });

  it('starts every synchronized repository disabled (scenario 1)', async () => {
    const list = await request(server()).get(`/api/installations/${installationId}/repositories`).set('Cookie', owner.cookie).expect(200);
    expect(list.body.items.every((r: { state: string }) => r.state === 'DISABLED')).toBe(true);
  });

  it('lets an owner enable a repository and records who and when (scenario 2)', async () => {
    const response = await put(owner, repoIds[0], { enabled: true }).expect(200);
    expect(response.body).toMatchObject({ id: repoIds[0], state: 'ENABLED' });
    expect(response.body.enabledAt).toBeTruthy();
    expect(await state(repoIds[0])).toBe(true);

    const [entry] = await audits('REPOSITORY_ENABLED');
    expect(entry).toMatchObject({ userId: owner.userId, resourceType: 'REPOSITORY', resourceId: repoIds[0] });
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.metadata).toEqual({ repository: 'acme/repo-0001' });
  });

  it('lets an owner disable it again without uninstalling the app (scenario 3)', async () => {
    await put(owner, repoIds[0], { enabled: true }).expect(200);
    const response = await put(owner, repoIds[0], { enabled: false }).expect(200);
    expect(response.body).toMatchObject({ state: 'DISABLED', enabledAt: null });
    expect(await audits('REPOSITORY_DISABLED')).toHaveLength(1);
    const installation = await world.infra.prisma.githubInstallation.findFirstOrThrow();
    expect(installation.status).toBe('ACTIVE');
  });

  it('is idempotent: repeating a request changes nothing and adds no audit entry', async () => {
    await put(owner, repoIds[0], { enabled: true }).expect(200);
    const first = await world.infra.prisma.repository.findUniqueOrThrow({ where: { id: repoIds[0] } });
    await put(owner, repoIds[0], { enabled: true }).expect(200);
    await put(owner, repoIds[0], { enabled: true }).expect(200);
    const after = await world.infra.prisma.repository.findUniqueOrThrow({ where: { id: repoIds[0] } });
    expect(after.enabledAt?.toISOString()).toBe(first.enabledAt?.toISOString());
    expect(await audits('REPOSITORY_ENABLED')).toHaveLength(1);
    await put(owner, repoIds[1], { enabled: false }).expect(200); // disabling a disabled one
    expect(await audits('REPOSITORY_DISABLED')).toHaveLength(0);
  });

  it('ends in the state of the final action however many times it is toggled (scenario 9)', async () => {
    for (const enabled of [true, false, true, true, false, true]) await put(owner, repoIds[0], { enabled }).expect(200);
    expect(await state(repoIds[0])).toBe(true);
    await put(owner, repoIds[0], { enabled: false }).expect(200);
    expect(await state(repoIds[0])).toBe(false);
  });

  it('ends in one consistent state when requests race', async () => {
    await Promise.all([true, false, true, false, true].map((enabled) => put(owner, repoIds[0], { enabled })));
    const final = await state(repoIds[0]);
    const enables = (await audits('REPOSITORY_ENABLED')).length;
    const disables = (await audits('REPOSITORY_DISABLED')).length;
    // Every audit entry corresponds to a real change: enables minus disables equals the final state.
    expect(enables - disables).toBe(final ? 1 : 0);
  });

  it('rejects a MEMBER and leaves the state unchanged (scenario 4)', async () => {
    const member = await signInAs(world, 11);
    const response = await put(member, repoIds[0], { enabled: true });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'FORBIDDEN', message: expect.any(String) });
    expect(await state(repoIds[0])).toBe(false);
    expect(await audits('REPOSITORY_ENABLED')).toHaveLength(0);
  });

  it('answers 404 to someone outside the organization, like a repository that does not exist', async () => {
    const outsider = await signInAs(world, 12);
    const foreign = await put(outsider, repoIds[0], { enabled: true }).expect(404);
    const missing = await put(outsider, '00000000-0000-4000-8000-000000000000', { enabled: true }).expect(404);
    expect(foreign.body).toEqual(missing.body);
    expect(await state(repoIds[0])).toBe(false);
  });

  it('answers 401 without a session and 403 without the CSRF token', async () => {
    await request(server()).put(`/api/repositories/${repoIds[0]}/review-enabled`).send({ enabled: true }).expect(401);
    const noCsrf = await request(server()).put(`/api/repositories/${repoIds[0]}/review-enabled`).set('Cookie', owner.cookie).send({ enabled: true });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF_INVALID');
  });

  it('refuses to enable a repository that is no longer accessible (409)', async () => {
    await world.infra.prisma.repository.update({ where: { id: repoIds[2] }, data: { status: 'INACCESSIBLE' } });
    const response = await put(owner, repoIds[2], { enabled: true }).expect(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(await state(repoIds[2])).toBe(false);
    // Disabling it is still allowed.
    await put(owner, repoIds[2], { enabled: false }).expect(200);
  });

  it('validates the request body', async () => {
    for (const body of [{}, { enabled: 'yes' }, { enabled: true, extra: 1 }, []]) {
      await put(owner, repoIds[0], body).expect(400);
    }
  });
});
