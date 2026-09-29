import request from 'supertest';
import { ReviewEligibilityService } from '../../src/repositories/review-eligibility';
import { fixtures } from '../fakes/webhook-fixtures';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { SignedIn, eventually, installAndSync, signInAs } from './support';
import { deliver } from './webhook-helpers';

/** FR-024 to FR-027, SC-009, US4 scenarios 4 to 6. */
describe('installation lifecycle', () => {
  let world: World;
  let session: SignedIn;
  let installationId: string;

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
    session = installed.session;
    installationId = installed.id;
    await world.infra.prisma.repository.updateMany({ data: { reviewEnabled: true, enabledAt: new Date() } });
  });

  const server = () => world.app.getHttpServer();
  const installation = () => world.infra.prisma.githubInstallation.findFirstOrThrow();
  const audits = (action: string) => world.infra.prisma.auditLog.findMany({ where: { action } });
  const eligible = async () => {
    const service = world.app.get(ReviewEligibilityService);
    const repos = await world.infra.prisma.repository.findMany();
    return Promise.all(repos.map((r) => service.isReviewEligible(r.id)));
  };

  describe('uninstall (US4 scenario 4, SC-009)', () => {
    it('removes the installation and makes every repository ineligible within a minute, with one audit entry', async () => {
      expect((await eligible()).every(Boolean)).toBe(true);

      const started = Date.now();
      world.github.removeInstallation(500);
      await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');
      expect(Date.now() - started).toBeLessThan(60_000);

      const removed = await installation();
      expect(removed.removedAt).not.toBeNull();
      const repos = await world.infra.prisma.repository.findMany();
      expect(repos).toHaveLength(3);
      expect(repos.every((r) => r.status === 'INACCESSIBLE' && !r.reviewEnabled)).toBe(true);
      expect((await eligible()).some(Boolean)).toBe(false);
      expect(await audits('GITHUB_INSTALLATION_REMOVED')).toHaveLength(1);
    });

    it('is shown as removed to its organization\'s members, with history kept', async () => {
      world.github.removeInstallation(500);
      await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');

      const detail = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie).expect(200);
      expect(detail.body).toMatchObject({ status: 'REMOVED', displayState: 'REMOVED' });
      const repos = await request(server()).get(`/api/installations/${installationId}/repositories`).set('Cookie', session.cookie).expect(200);
      expect(repos.body.items.every((r: { state: string }) => r.state === 'INACCESSIBLE')).toBe(true);
    });

    it('does not repeat the audit entry or change anything on repeated or late events', async () => {
      world.github.removeInstallation(500);
      const webhook = fixtures.installationDeleted(500);
      await deliver(world.app, webhook).expect(202);
      await deliver(world.app, webhook).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');
      await deliver(world.app, fixtures.installationDeleted(500, 1000, 'acme')).expect(202);
      await eventually(async () => (await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } })) === 0);
      expect(await audits('GITHUB_INSTALLATION_REMOVED')).toHaveLength(1);
    });

    it('never synchronizes or lets anyone manage a removed installation', async () => {
      world.github.removeInstallation(500);
      await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');
      const before = world.github.countRequests('GET', '/installation/repositories');
      await deliver(world.app, fixtures.installationRepositoriesAdded(500)).expect(202);
      await eventually(async () => (await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } })) === 0);
      expect(world.github.countRequests('GET', '/installation/repositories')).toBe(before);
    });
  });

  describe('suspend and unsuspend (US4 scenario 5, FR-025)', () => {
    it('makes repositories ineligible while suspended and eligible again afterwards, one audit entry each', async () => {
      world.github.installations.get(500)!.suspended = true;
      await deliver(world.app, fixtures.installationSuspended(500)).expect(202);
      await eventually(async () => (await installation()).status === 'SUSPENDED');
      expect((await installation()).suspendedAt).not.toBeNull();
      expect((await eligible()).some(Boolean)).toBe(false);
      const detail = await request(server()).get(`/api/installations/${installationId}`).set('Cookie', session.cookie).expect(200);
      expect(detail.body.displayState).toBe('SUSPENDED');
      expect(await audits('GITHUB_INSTALLATION_SUSPENDED')).toHaveLength(1);

      // The owner's choices are kept, so unsuspending restores them.
      world.github.installations.get(500)!.suspended = false;
      await deliver(world.app, fixtures.installationUnsuspended(500)).expect(202);
      await eventually(async () => (await installation()).status === 'ACTIVE');
      expect((await eligible()).every(Boolean)).toBe(true);
      expect(await audits('GITHUB_INSTALLATION_UNSUSPENDED')).toHaveLength(1);
      expect((await installation()).suspendedAt).toBeNull();
    });

    it('does not add audit entries when the same state is reported again', async () => {
      world.github.installations.get(500)!.suspended = true;
      await deliver(world.app, fixtures.installationSuspended(500)).expect(202);
      await eventually(async () => (await installation()).status === 'SUSPENDED');
      await deliver(world.app, fixtures.installationSuspended(500, 1000, 'acme')).expect(202);
      await deliver(world.app, fixtures.installationSuspended(500, 1000, 'acme')).expect(202);
      await eventually(async () => (await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } })) === 0);
      expect(await audits('GITHUB_INSTALLATION_SUSPENDED')).toHaveLength(1);
    });

    it('does not synchronize while suspended', async () => {
      world.github.installations.get(500)!.suspended = true;
      await deliver(world.app, fixtures.installationSuspended(500)).expect(202);
      await eventually(async () => (await installation()).status === 'SUSPENDED');
      const before = world.github.countRequests('GET', '/installation/repositories');
      await deliver(world.app, fixtures.installationRepositoriesAdded(500)).expect(202);
      await eventually(async () => (await world.infra.prisma.webhookDelivery.count({ where: { status: 'RECEIVED' } })) === 0);
      expect(world.github.countRequests('GET', '/installation/repositories')).toBe(before);
    });
  });

  describe('reinstall (US4 scenario 6, FR-026)', () => {
    it('creates a new installation under the same organization and keeps the removed one', async () => {
      world.github.removeInstallation(500);
      await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');
      const organizations = await world.infra.prisma.organization.count();

      // GitHub gives the reinstall a new installation id (501) for the same account.
      seedInstallation(world.github, { installationId: 501, accountId: 1000, login: 'acme', users: [10, 11], repos: makeRepos(3) });
      await deliver(world.app, fixtures.installationCreated(501)).expect(202);
      await eventually(async () => (await world.infra.prisma.githubInstallation.count()) === 2);
      await eventually(async () => (await world.infra.prisma.githubInstallation.findUniqueOrThrow({ where: { githubInstallationId: 501n } })).syncStatus === 'SYNCED');

      expect(await world.infra.prisma.organization.count()).toBe(organizations); // no duplicate organization
      const installations = await world.infra.prisma.githubInstallation.findMany({ orderBy: { githubInstallationId: 'asc' } });
      expect(installations.map((i) => [Number(i.githubInstallationId), i.status])).toEqual([[500, 'REMOVED'], [501, 'ACTIVE']]);
      expect(installations[0].organizationId).toBe(installations[1].organizationId);
      expect(installations[0].removedAt).not.toBeNull(); // the earlier record is untouched

      // All repositories start disabled again; the earlier enabled choice does not come back.
      const repos = await world.infra.prisma.repository.findMany();
      expect(repos).toHaveLength(3);
      expect(repos.every((r) => r.status === 'ACCESSIBLE' && !r.reviewEnabled && r.installationId === installations[1].id)).toBe(true);
      expect(await audits('GITHUB_INSTALLATION_ADDED')).toHaveLength(2);
    });

    it('shows the removed and the new installation side by side to the organization\'s members', async () => {
      world.github.removeInstallation(500);
      await deliver(world.app, fixtures.installationDeleted(500)).expect(202);
      await eventually(async () => (await installation()).status === 'REMOVED');
      seedInstallation(world.github, { installationId: 501, accountId: 1000, login: 'acme', users: [10, 11], repos: makeRepos(2) });
      await deliver(world.app, fixtures.installationCreated(501)).expect(202);
      await eventually(async () => (await world.infra.prisma.githubInstallation.count()) === 2);

      const fresh = await signInAs(world, 10); // a fresh sign-in derives access to the new installation
      const list = await request(server()).get('/api/installations').set('Cookie', fresh.cookie).expect(200);
      expect(list.body.items.map((i: { displayState: string }) => i.displayState).sort()).toEqual(['ACTIVE', 'REMOVED']);
    });
  });
});
