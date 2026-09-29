import request from 'supertest';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, installAndSync, makeOwner, signInAs } from './support';

/** FR-020, SC-007, US6 scenarios 1, 2 and 4, and the permission matrix of FR-040 that exists so far. */
describe('tenant isolation', () => {
  let world: World;
  let alice: { session: SignedIn; id: string }; // acme
  let bob: { session: SignedIn; id: string }; // globex
  let acmeRepoId: string;
  let globexRepoId: string;

  beforeAll(async () => {
    world = await startWorld();
    world.startWorker();
    seedInstallation(world.github, { installationId: 500, accountId: 1000, login: 'acme', users: [10], repos: makeRepos(3, 'acme', 100) });
    seedInstallation(world.github, { installationId: 600, accountId: 2000, login: 'globex', users: [20], repos: makeRepos(3, 'globex', 200) });
    alice = await installAndSync(world, 10, 500);
    bob = await installAndSync(world, 20, 600);
    const acme = await request(world.app.getHttpServer()).get(`/api/installations/${alice.id}/repositories`).set('Cookie', alice.session.cookie);
    const globex = await request(world.app.getHttpServer()).get(`/api/installations/${bob.id}/repositories`).set('Cookie', bob.session.cookie);
    acmeRepoId = acme.body.items[0].id;
    globexRepoId = globex.body.items[0].id;
  });

  afterAll(async () => {
    await world.stop();
  });

  const server = () => world.app.getHttpServer();
  const get = (path: string, who: { session: SignedIn } | null) => {
    const req = request(server()).get(path);
    return who ? req.set('Cookie', who.session.cookie) : req;
  };
  const MISSING = '00000000-0000-4000-8000-000000000000';

  it('shows each user only their own organization (scenario 1)', async () => {
    const a = await get('/api/installations', alice).expect(200);
    const b = await get('/api/installations', bob).expect(200);
    expect(a.body.items.map((i: { organization: { login: string } }) => i.organization.login)).toEqual(['acme']);
    expect(b.body.items.map((i: { organization: { login: string } }) => i.organization.login)).toEqual(['globex']);
  });

  it('answers another organization\'s installation exactly like one that does not exist (scenario 2)', async () => {
    const foreign = await get(`/api/installations/${bob.id}`, alice).expect(404);
    const missing = await get(`/api/installations/${MISSING}`, alice).expect(404);
    const malformed = await get('/api/installations/not-a-uuid', alice).expect(404);
    expect(foreign.body).toEqual(missing.body);
    expect(malformed.body).toEqual(missing.body);
    expect(foreign.text).toBe(missing.text);
  });

  it('gives the same 404 for the repositories of another organization, with any search, filter or paging', async () => {
    const missing = await get(`/api/installations/${MISSING}/repositories`, alice).expect(404);
    for (const query of ['', '?q=globex', '?q=repo-0001&state=DISABLED', '?limit=1', `?cursor=${globexRepoId}`]) {
      const foreign = await get(`/api/installations/${bob.id}/repositories${query}`, alice).expect(404);
      expect(foreign.body).toEqual(missing.body);
    }
  });

  it('does not let a cursor from another organization reveal anything in your own list', async () => {
    const withForeignCursor = await get(`/api/installations/${alice.id}/repositories?cursor=${globexRepoId}`, alice).expect(200);
    const withRandomCursor = await get(`/api/installations/${alice.id}/repositories?cursor=${MISSING}`, alice).expect(200);
    expect(withForeignCursor.body).toEqual(withRandomCursor.body);
    expect(JSON.stringify(withForeignCursor.body)).not.toContain('globex');
  });

  it('keeps searches and counts inside the organization', async () => {
    const search = await get(`/api/installations/${alice.id}/repositories?q=globex`, alice).expect(200);
    expect(search.body.items).toEqual([]);
    const own = await get(`/api/installations/${alice.id}`, alice).expect(200);
    expect(own.body.repositoryCount).toBe(3);
    const everything = JSON.stringify((await get('/api/installations', alice)).body);
    expect(everything).not.toContain('globex');
    expect(everything).not.toContain(bob.id);
  });

  it('shows every user only their own organizations in /me (scenario 4 partly)', async () => {
    const me = await get('/api/me', alice).expect(200);
    expect(me.body.organizations.map((o: { login: string }) => o.login)).toEqual(['acme']);
    expect(JSON.stringify(me.body)).not.toContain('globex');
  });

  it('a user in several organizations sees each separately and nothing else (scenario 4)', async () => {
    world.github.grantAccess(10, 600);
    const both = await signInAs(world, 10); // signing in again re-reads what GitHub lists
    const me = await get('/api/me', { session: both }).expect(200);
    expect(me.body.organizations.map((o: { login: string }) => o.login).sort()).toEqual(['acme', 'globex']);
    const list = await get('/api/installations', { session: both }).expect(200);
    expect(list.body.items).toHaveLength(2);
    world.github.revokeAccess(10, 600);
    await signInAs(world, 10);
  });

  it('requires a session for every read route', async () => {
    for (const path of ['/api/installations', `/api/installations/${alice.id}`, `/api/installations/${alice.id}/repositories`, '/api/me']) {
      const response = await get(path, null);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED', message: expect.any(String) });
    }
  });

  describe('permission matrix cells available so far (spec FR-040)', () => {
    it('visitor (signed out): may sign in, may not start installation, refresh access or view', async () => {
      await request(server()).get('/api/auth/github/login').expect(302);
      await request(server()).get('/api/installations/new').expect(401);
      await request(server()).get('/api/me/refresh-access').expect(401);
      await get('/api/installations', null).expect(401);
    });

    it('signed-in user who is not a member: may start installation and refresh access, sees nothing', async () => {
      const outsider = await signInAs(world, 30);
      await request(server()).get('/api/installations/new').set('Cookie', outsider.cookie).expect(302);
      await request(server()).get('/api/me/refresh-access').set('Cookie', outsider.cookie).expect(302);
      expect((await get('/api/installations', { session: outsider })).body.items).toEqual([]);
      await get(`/api/installations/${alice.id}`, { session: outsider }).expect(404);
    });

    it('MEMBER: may view their organization, start installation and refresh access', async () => {
      await get(`/api/installations/${alice.id}`, alice).expect(200);
      await request(server()).get('/api/installations/new').set('Cookie', alice.session.cookie).expect(302);
      await request(server()).get('/api/me/refresh-access').set('Cookie', alice.session.cookie).expect(302);
    });
  });

  describe('permission matrix, management cells (spec FR-040)', () => {
    const put = (who: { session: SignedIn } | null, id: string) => {
      const req = request(server()).put(`/api/repositories/${id}/review-enabled`);
      return (who ? req.set('Cookie', who.session.cookie).set('X-CSRF-Token', who.session.csrfToken) : req).send({ enabled: false });
    };
    const sync = (who: { session: SignedIn } | null, id: string) => {
      const req = request(server()).post(`/api/installations/${id}/sync`);
      return who ? req.set('Cookie', who.session.cookie).set('X-CSRF-Token', who.session.csrfToken) : req;
    };

    it('visitor: cannot enable, disable or re-run synchronization (401)', async () => {
      await put(null, acmeRepoId).expect(401);
      await sync(null, alice.id).expect(401);
    });

    it('signed-in non-member: cannot, and cannot tell the resource exists (404)', async () => {
      const outsider = { session: await signInAs(world, 31) };
      await put(outsider, acmeRepoId).expect(404);
      await sync(outsider, alice.id).expect(404);
    });

    it('MEMBER: cannot change anything (403), and not in another organization either (404)', async () => {
      await put(alice, acmeRepoId).expect(403);
      await sync(alice, alice.id).expect(403);
      await put(alice, globexRepoId).expect(404);
      await sync(alice, bob.id).expect(404);
    });

    it('OWNER: can enable, disable and re-run synchronization in their own organization only', async () => {
      await makeOwner(world, alice.session);
      await put(alice, acmeRepoId).expect(200);
      await sync(alice, alice.id).expect(202);
      await put(alice, globexRepoId).expect(404);
      await sync(alice, bob.id).expect(404);
    });
  });

  it('is unable to reach another organization through the repository ids either', async () => {
    // Repository ids only ever appear inside an installation the caller can see.
    const own = await get(`/api/installations/${alice.id}/repositories`, alice).expect(200);
    expect(own.body.items.map((r: { id: string }) => r.id)).toContain(acmeRepoId);
    expect(own.body.items.map((r: { id: string }) => r.id)).not.toContain(globexRepoId);
  });
});
