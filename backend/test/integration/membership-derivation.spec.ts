import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { completeInstall, installAndSync, signInAs } from './support';

/**
 * Membership is derived from what GitHub lists as accessible (FR-010, FR-036, US6 scenarios 1, 4).
 * Role derivation from GitHub (OWNER for organization owners) is task T077, which waits for gate G1;
 * until then everyone GitHub lists is a MEMBER.
 */
describe('membership derivation', () => {
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
  const memberships = () => world.infra.prisma.organizationMember.findMany({ include: { organization: true, user: true } });

  it('makes a user a MEMBER of every organization whose installation GitHub lists for them', async () => {
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', users: [10], repos: makeRepos(1) });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', users: [10, 20], repos: makeRepos(1, 'globex', 300) });
    await installAndSync(world, 10, 500);
    await installAndSync(world, 20, 600);

    // User 10 signs in again: GitHub now lists both installations for them.
    const session = await signInAs(world, 10);
    const me = await request(server()).get('/api/me').set('Cookie', session.cookie).expect(200);
    expect(me.body.organizations).toEqual([
      { id: expect.any(String), login: 'acme', role: 'MEMBER' },
      { id: expect.any(String), login: 'globex', role: 'MEMBER' },
    ]);
    const list = await request(server()).get('/api/installations').set('Cookie', session.cookie).expect(200);
    expect(list.body.items.map((i: { organization: { login: string } }) => i.organization.login).sort()).toEqual(['acme', 'globex']);
  });

  it('gives a user of a personal-account installation a membership too', async () => {
    seedInstallation(world.github, { installationId: 700, accountId: 10, login: 'user-10', type: 'User', users: [10], repos: makeRepos(1, 'user-10') });
    const { session } = await installAndSync(world, 10, 700);
    const me = await request(server()).get('/api/me').set('Cookie', session.cookie).expect(200);
    expect(me.body.organizations.map((o: { login: string }) => o.login)).toEqual(['user-10']);
    const org = await world.infra.prisma.organization.findFirstOrThrow({ where: { login: 'user-10' } });
    expect(org.accountType).toBe('USER');
  });

  it('never changes an existing role or role_verified_at when access is derived again', async () => {
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', users: [10], repos: makeRepos(1) });
    seedInstallation(world.github, { installationId: 501, accountId: 1000, login: 'acme', users: [10], repos: makeRepos(1, 'acme', 400) });
    const { session } = await installAndSync(world, 10, 500);

    // A role confirmed by GitHub earlier (set here directly, as role verification will do).
    const verifiedAt = new Date('2026-01-01T00:00:00Z');
    await world.infra.prisma.organizationMember.updateMany({ data: { role: 'OWNER', roleVerifiedAt: verifiedAt } });

    // Another install callback for the same organization, and a fresh sign-in, derive access again.
    await completeInstall(world.app, world.github, session, 10, 501);
    await signInAs(world, 10);

    const [membership] = await memberships();
    expect(membership).toMatchObject({ role: 'OWNER' });
    expect(membership.roleVerifiedAt?.toISOString()).toBe(verifiedAt.toISOString());
    expect(await memberships()).toHaveLength(1);
  });

  it('does not create a second membership for the same user and organization', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
    await installAndSync(world, 10, 500);
    for (let i = 0; i < 3; i += 1) await signInAs(world, 10);
    expect(await memberships()).toHaveLength(1);
  });

  it.todo('sets OWNER for a GitHub organization owner and the personal-account holder (task T077, blocked by gate G1)');
});
