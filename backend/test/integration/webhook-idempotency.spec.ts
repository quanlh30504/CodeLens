import { fixtures, signedWebhook } from '../fakes/webhook-fixtures';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { eventually } from './support';
import { deliver, tableCounts } from './webhook-helpers';

/** FR-029, SC-005, US5 scenarios 2 and 3. */
describe('webhook idempotency', () => {
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

  const settled = () =>
    eventually(async () => {
      const installation = await world.infra.prisma.githubInstallation.findFirst();
      const pending = await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } });
      return installation?.syncStatus === 'SYNCED' && pending === 0;
    });

  it('has the same effect when one delivery arrives ten times, one after another (SC-005)', async () => {
    seedInstallation(world.github, { repos: makeRepos(4) });
    const webhook = fixtures.installationCreated(500);
    for (let i = 0; i < 10; i += 1) {
      const response = await deliver(world.app, webhook);
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'accepted' });
    }
    await settled();

    const counts = await tableCounts(world.infra.prisma);
    expect(counts).toMatchObject({ deliveries: 1, installations: 1, organizations: 1, repositories: 4 });
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'GITHUB_INSTALLATION_ADDED' } })).toBe(1);
    expect((await world.infra.prisma.webhookDelivery.findFirstOrThrow()).status).toBe('PROCESSED');
  });

  it('has the same effect when two identical deliveries arrive at the same moment (scenario 3)', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    const webhook = fixtures.installationCreated(500);
    const responses = await Promise.all(Array.from({ length: 10 }, () => deliver(world.app, webhook)));
    expect(responses.every((r) => r.status === 202)).toBe(true);
    await settled();

    expect(await tableCounts(world.infra.prisma)).toMatchObject({ deliveries: 1, installations: 1, organizations: 1, repositories: 3 });
    expect(await world.infra.prisma.auditLog.count()).toBe(1);
  });

  it('gives a repeat exactly the same acknowledgement as the first delivery (FR-028)', async () => {
    const webhook = fixtures.ping();
    const first = await deliver(world.app, webhook);
    const repeat = await deliver(world.app, webhook);
    expect(repeat.status).toBe(first.status);
    expect(repeat.body).toEqual(first.body);
  });

  it('treats distinct deliveries with identical content each as processed, without a second change', async () => {
    seedInstallation(world.github, { repos: makeRepos(3) });
    const one = signedWebhook('installation', JSON.parse(fixtures.installationCreated(500).body), { deliveryId: 'delivery-one' });
    const two = signedWebhook('installation', JSON.parse(one.body), { deliveryId: 'delivery-two' });
    await deliver(world.app, one).expect(202);
    await deliver(world.app, two).expect(202);
    await settled();

    const deliveries = await world.infra.prisma.webhookDelivery.findMany({ orderBy: { deliveryGuid: 'asc' } });
    expect(deliveries.map((d) => [d.deliveryGuid, d.status])).toEqual([
      ['delivery-one', 'PROCESSED'],
      ['delivery-two', 'PROCESSED'],
    ]);
    expect(await tableCounts(world.infra.prisma)).toMatchObject({ installations: 1, organizations: 1, repositories: 3 });
    expect(await world.infra.prisma.auditLog.count({ where: { action: 'GITHUB_INSTALLATION_ADDED' } })).toBe(1);
  });

  it('marks a delivery failed with a code only after the last retry', async () => {
    seedInstallation(world.github, { repos: makeRepos(1) });
    world.github.failNext(/^\/app\/installations\/500$/, 503, 100);
    await deliver(world.app, fixtures.installationCreated(500, 1000, 'acme', 'fail-me')).expect(202);
    const delivery = await eventually(async () => {
      const d = await world.infra.prisma.webhookDelivery.findFirst({ where: { deliveryGuid: 'fail-me' } });
      return d && d.status !== 'RECEIVED' ? d : false;
    });
    expect(delivery).toMatchObject({ status: 'FAILED', errorCode: 'GITHUB_UNAVAILABLE' });
    expect(await world.infra.prisma.githubInstallation.count()).toBe(0);
  });
});
