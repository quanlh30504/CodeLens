import { ReviewEligibilityService, isEligible } from '../../src/repositories/review-eligibility';
import { World, makeRepos, seedInstallation, startWorld } from './scenario';
import { installAndSync } from './support';

/** FR-022, SC-008: one rule, evaluated on current state every time. */
describe('review eligibility', () => {
  describe('rule (unit)', () => {
    const facts = (repository: string, enabled: boolean, installation: string) => ({
      repository: { status: repository, reviewEnabled: enabled },
      installation: { status: installation },
    });

    it('is eligible only when accessible, enabled and the installation is active', () => {
      expect(isEligible(facts('ACCESSIBLE', true, 'ACTIVE'))).toBe(true);
    });

    it.each([
      ['disabled', facts('ACCESSIBLE', false, 'ACTIVE')],
      ['inaccessible', facts('INACCESSIBLE', true, 'ACTIVE')],
      ['suspended', facts('ACCESSIBLE', true, 'SUSPENDED')],
      ['removed', facts('ACCESSIBLE', true, 'REMOVED')],
      ['unknown', null],
    ])('is not eligible when %s', (_name, input) => {
      expect(isEligible(input)).toBe(false);
    });
  });

  describe('against the database', () => {
    let world: World;
    let service: ReviewEligibilityService;

    beforeAll(async () => {
      world = await startWorld();
      world.startWorker();
      service = world.app.get(ReviewEligibilityService);
    });

    afterAll(async () => {
      await world.stop();
    });

    beforeEach(async () => {
      await world.reset();
    });

    async function oneRepository() {
      seedInstallation(world.github, { users: [10], repos: makeRepos(1) });
      await installAndSync(world, 10, 500);
      return world.infra.prisma.repository.findFirstOrThrow();
    }

    it('follows every change immediately, reading current state each time (SC-008)', async () => {
      const repo = await oneRepository();
      expect(await service.isReviewEligible(repo.id)).toBe(false); // starts disabled

      await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: true } });
      expect(await service.isReviewEligible(repo.id)).toBe(true);

      await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: false } });
      expect(await service.isReviewEligible(repo.id)).toBe(false);
      expect(await service.isReviewEligible(repo.id)).toBe(false);
    });

    it('is false when the installation is suspended or removed, and true again after unsuspend', async () => {
      const repo = await oneRepository();
      await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: true } });
      expect(await service.isReviewEligible(repo.id)).toBe(true);

      await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'SUSPENDED' } });
      expect(await service.isReviewEligible(repo.id)).toBe(false);
      await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'ACTIVE' } });
      expect(await service.isReviewEligible(repo.id)).toBe(true);
      await world.infra.prisma.githubInstallation.updateMany({ data: { status: 'REMOVED' } });
      expect(await service.isReviewEligible(repo.id)).toBe(false);
    });

    it('is false for a repository GitHub no longer reports, and for one that does not exist', async () => {
      const repo = await oneRepository();
      await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: true } });
      await world.infra.prisma.repository.update({ where: { id: repo.id }, data: { reviewEnabled: false, status: 'INACCESSIBLE' } });
      expect(await service.isReviewEligible(repo.id)).toBe(false);
      expect(await service.isReviewEligible('00000000-0000-4000-8000-000000000000')).toBe(false);
    });
  });
});
