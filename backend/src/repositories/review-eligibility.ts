import { Injectable } from '@nestjs/common';
import { PrismaService } from '../tenancy/prisma.service';

/**
 * THE rule for whether a repository may be reviewed (spec FR-022, SC-008). Every future feature
 * that starts review work MUST call this before doing anything, so that disabling a repository,
 * losing access, suspension and uninstalling all stop review immediately.
 *
 * Eligible only if the repository is accessible on GitHub AND was enabled by an owner AND its
 * installation is active. It reads current state on every call; nothing is cached.
 */
export interface EligibilityFacts {
  repository: { status: string; reviewEnabled: boolean };
  installation: { status: string };
}

export function isEligible(facts: EligibilityFacts | null | undefined): boolean {
  if (!facts) return false;
  return (
    facts.repository.status === 'ACCESSIBLE' && facts.repository.reviewEnabled && facts.installation.status === 'ACTIVE'
  );
}

@Injectable()
export class ReviewEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async isReviewEligible(repositoryId: string): Promise<boolean> {
    const row = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { status: true, reviewEnabled: true, installation: { select: { status: true } } },
    });
    if (!row) return false;
    return isEligible({ repository: row, installation: row.installation });
  }
}

/** Convenience wrapper for callers that hold a PrismaService. */
export const isReviewEligible = (prisma: PrismaService, repositoryId: string): Promise<boolean> =>
  new ReviewEligibilityService(prisma).isReviewEligible(repositoryId);
