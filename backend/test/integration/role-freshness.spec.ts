import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, installAndSync, makeOwner, signInAs } from './support';

/**
 * A role GitHub confirmed more than 10 minutes ago is never trusted for a management action
 * (FR-037, FR-038, US3 scenarios 5 to 8, SC-012). The part that asks GitHub again (task T092)
 * waits for gate G1; here the outcome of that confirmation is set in the database.
 */
describe('role freshness', () => {
  let world: World;
  let owner: SignedIn;
  let repoId: string;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
  });

  afterAll(async () => {
    await world.stop();
  });

  beforeEach(async () => {
    await world.reset();
    seedInstallation(world.github, { users: [10, 11], repos: makeRepos(1) });
    owner = (await installAndSync(world, 10, 500)).session;
    repoId = (await world.infra.prisma.repository.findFirstOrThrow()).id;
  });

  const enable = (session: SignedIn) =>
    request(world.app.getHttpServer())
      .put(`/api/repositories/${repoId}/review-enabled`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .send({ enabled: true });
  const enabled = async () => (await world.infra.prisma.repository.findUniqueOrThrow({ where: { id: repoId } })).reviewEnabled;

  it('accepts a role confirmed a moment ago and up to ten minutes ago', async () => {
    await makeOwner(world, owner, 9);
    await enable(owner).expect(200);
  });

  it.each([11, 60, 24 * 60])('asks for re-confirmation when the role was confirmed %d minutes ago, and changes nothing', async (minutes) => {
    await makeOwner(world, owner, minutes);
    const response = await enable(owner);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'REAUTH_REQUIRED', message: expect.any(String) });
    expect(await enabled()).toBe(false);
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'REPOSITORY_ENABLED' } })).toBe(0);
  });

  it('never trusts a role that was never confirmed', async () => {
    await world.infra.prisma.organizationMember.updateMany({ where: { userId: owner.userId }, data: { role: 'OWNER', roleVerifiedAt: null } });
    const response = await enable(owner);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('REAUTH_REQUIRED');
  });

  it('applies the change once the role has been confirmed again', async () => {
    await makeOwner(world, owner, 30);
    await enable(owner).expect(403);
    // A successful confirmation with GitHub records the current time (what task T092 will do).
    await makeOwner(world, owner, 0);
    await enable(owner).expect(200);
    expect(await enabled()).toBe(true);
  });

  it('rejects an owner GitHub has since demoted as soon as their role is re-read', async () => {
    await makeOwner(world, owner, 0);
    // Re-confirmation found them to be an ordinary member.
    await world.infra.prisma.organizationMember.updateMany({ where: { userId: owner.userId }, data: { role: 'MEMBER', roleVerifiedAt: new Date() } });
    const response = await enable(owner);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(await enabled()).toBe(false);
  });

  it('rejects the person who installed the app when GitHub does not report them as an owner (scenario 8)', async () => {
    // owner is the installer; nothing has made them an owner.
    const response = await enable(owner);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('a fresh member role is not enough either', async () => {
    const member = await signInAs(world, 11);
    await world.infra.prisma.organizationMember.updateMany({ where: { userId: member.userId }, data: { roleVerifiedAt: new Date() } });
    const response = await enable(member);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it.todo('asks GitHub again on REAUTH_REQUIRED and updates the role (task T092, gate G1)');
  it.todo('refuses with 503 ROLE_UNVERIFIABLE when GitHub cannot be reached, trusting no stored role (task T092, gate G1)');
});
