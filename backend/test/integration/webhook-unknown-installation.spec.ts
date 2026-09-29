import { fixtures } from '../fakes/webhook-fixtures';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { eventually, signInAs } from './support';
import { deliver } from './webhook-helpers';
import request from 'supertest';

/** US5 scenario 5, FR-010, FR-031, US5 scenario 6. */
describe('events for installations no user has claimed', () => {
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

  const list = (cookie: string) => request(world.app.getHttpServer()).get('/api/installations').set('Cookie', cookie);

  it('records the installation but shows it to nobody until GitHub confirms a user can access it', async () => {
    // Installation 500 exists on GitHub; only user 11 may access it; nobody has visited CodeLens for it.
    seedInstallation(world.github, { users: [11], repos: makeRepos(2) });
    world.github.addUser({ id: 10, login: 'outsider' });
    await deliver(world.app, fixtures.installationCreated(500)).expect(202);
    await eventually(async () => (await world.infra.prisma.repository.count()) === 2);

    // Recorded...
    expect(await world.infra.prisma.githubInstallation.count()).toBe(1);
    // ...but invisible to a user GitHub does not list for it, and to a user not yet confirmed.
    const outsider = await signInAs(world, 10);
    expect((await list(outsider.cookie)).body.items).toEqual([]);

    // The user GitHub lists signs in: the sign-in confirms access, and the installation appears.
    const insider = await signInAs(world, 11);
    const visible = await list(insider.cookie);
    expect(visible.body.items).toHaveLength(1);
    expect(visible.body.items[0].organization.login).toBe('acme');
    expect(visible.body.items[0].canManage).toBe(false);

    // The outsider still sees nothing, and cannot fetch it by id.
    expect((await list(outsider.cookie)).body.items).toEqual([]);
    await request(world.app.getHttpServer())
      .get(`/api/installations/${visible.body.items[0].id}`)
      .set('Cookie', outsider.cookie)
      .expect(404);
  });

  it('acknowledges quickly while a long synchronization runs, well inside GitHub\'s 10 seconds (FR-031)', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    // Reading repositories from GitHub takes 11 seconds, longer than GitHub waits for a reply.
    world.github.latencies = [{ match: /installation\/repositories/, ms: 11_000 }];

    const timings: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const started = Date.now();
      const response = await deliver(world.app, i === 0 ? fixtures.installationCreated(500) : fixtures.installationRepositoriesAdded(500));
      timings.push(Date.now() - started);
      expect(response.status).toBe(202);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)];
    expect(p95).toBeLessThan(2000);
    expect(Math.max(...timings)).toBeLessThan(10_000);

    // The work still finishes afterwards.
    world.github.latencies = [];
    await eventually(async () => (await world.infra.prisma.repository.count()) === 3, 60_000);
  }, 120_000);
});
