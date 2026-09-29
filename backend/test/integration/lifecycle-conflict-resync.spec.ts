import request from 'supertest';
import { SyncService } from '../../src/repositories/sync.service';
import { ReconcileService } from '../../src/installations/reconcile.service';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, eventually, installAndSync, makeOwner } from './support';

/** US4 scenario 7 and the two-installation rule (research R7, FR-013). */
describe('missed events and overlapping installations', () => {
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

  it('repairs a missed event when an owner re-runs synchronization (scenario 7)', async () => {
    seedInstallation(world.github, { users: [10], repos: makeRepos(2) });
    const { session, id } = await installAndSync(world, 10, 500);
    await makeOwner(world, session);

    // GitHub changed but CodeLens never heard about it.
    world.github.installations.get(500)!.repos = makeRepos(4).slice(1);
    world.github.installations.get(500)!.selection = 'all';
    await request(server())
      .post(`/api/installations/${id}/sync`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(202);
    await eventually(async () => (await world.infra.prisma.repository.count()) === 4);

    const repos = await request(server()).get(`/api/installations/${id}/repositories`).set('Cookie', session.cookie).expect(200);
    const byName = Object.fromEntries(repos.body.items.map((r: { fullName: string; state: string }) => [r.fullName, r.state]));
    expect(byName).toEqual({
      'acme/repo-0001': 'INACCESSIBLE',
      'acme/repo-0002': 'DISABLED',
      'acme/repo-0003': 'DISABLED',
      'acme/repo-0004': 'DISABLED',
    });
  });

  describe('a repository reported by two installations', () => {
    let alice: SignedIn;
    let bob: SignedIn;
    let aliceInstallation: string;
    let bobInstallation: string;

    beforeEach(async () => {
      const repo = { id: 77, name: 'shared', owner: 'acme' };
      seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', users: [10], repos: [repo] });
      seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', users: [20], repos: [] });
      const a = await installAndSync(world, 10, 500);
      alice = a.session;
      aliceInstallation = a.id;
      const b = await installAndSync(world, 20, 600);
      bob = b.session;
      bobInstallation = b.id;
    });

    it('keeps the current holder, flags it for operators, and reveals nothing to either tenant', async () => {
      // The second installation also reports the repository while the first still has access.
      world.github.installations.get(600)!.repos = [{ id: 77, name: 'shared', owner: 'acme' }];
      await world.app.get(SyncService).sync(600);

      const row = await world.infra.prisma.repository.findFirstOrThrow();
      const acme = await world.infra.prisma.organization.findFirstOrThrow({ where: { login: 'acme' } });
      expect(row).toMatchObject({ organizationId: acme.id, syncConflict: true });

      for (const [who, id, other] of [[alice, aliceInstallation, 'globex'], [bob, bobInstallation, 'acme']] as const) {
        const detail = await request(server()).get(`/api/installations/${id}`).set('Cookie', who.cookie).expect(200);
        const repos = await request(server()).get(`/api/installations/${id}/repositories`).set('Cookie', who.cookie).expect(200);
        const text = JSON.stringify([detail.body, repos.body]);
        expect(text).not.toMatch(/syncConflict|sync_conflict|conflict/i);
        expect(text).not.toContain(other);
      }
      // The overlapping installation does not list it.
      const bobRepos = await request(server()).get(`/api/installations/${bobInstallation}/repositories`).set('Cookie', bob.cookie).expect(200);
      expect(bobRepos.body.items).toEqual([]);
    });

    it('moves it once the first installation loses access', async () => {
      world.github.installations.get(600)!.repos = [{ id: 77, name: 'shared', owner: 'globex' }];
      world.github.installations.get(500)!.repos = [];
      await world.app.get(SyncService).sync(600);
      const row = await world.infra.prisma.repository.findFirstOrThrow({ include: { organization: true } });
      expect(row.organization.login).toBe('globex');
      expect(row.syncConflict).toBe(false);
      const list = await request(server()).get(`/api/installations/${aliceInstallation}/repositories`).set('Cookie', alice.cookie).expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('a later synchronization clears the flag when the overlap ends', async () => {
      world.github.installations.get(600)!.repos = [{ id: 77, name: 'shared', owner: 'acme' }];
      await world.app.get(SyncService).sync(600);
      expect((await world.infra.prisma.repository.findFirstOrThrow()).syncConflict).toBe(true);
      world.github.installations.get(600)!.repos = [];
      await world.app.get(ReconcileService).reconcile(600);
      await world.app.get(SyncService).sync(500);
      // The holder's own synchronization sees the row unchanged apart from the flag.
      expect((await world.infra.prisma.repository.findFirstOrThrow()).syncConflict).toBe(false);
    });
  });
});
