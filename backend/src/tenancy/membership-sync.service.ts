import { Injectable } from '@nestjs/common';
import type { GithubAccessibleInstallation } from '../github/github-user.client';
import { PrismaService } from './prisma.service';

/**
 * Access derivation (spec FR-010, FR-036): a user becomes a member of an organization when
 * GitHub lists one of that organization's installations as accessible to them.
 *
 *  - It only ever INSERTS memberships with role MEMBER; it never changes an existing role or
 *    role_verified_at (roles are set only by role verification, so this cannot demote an OWNER).
 *  - It removes a membership only when GitHub stops listing every live installation of that
 *    organization for the user. Organizations whose installations are all removed keep their
 *    memberships, because GitHub can no longer be asked (a documented trade-off: removed history
 *    stays visible to former members).
 */
@Injectable()
export class MembershipSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncFromAccessibleInstallations(userId: string, accessible: GithubAccessibleInstallation[]): Promise<void> {
    const ids = accessible.map((i) => BigInt(i.githubInstallationId));

    await this.prisma.$transaction(async (tx) => {
      const reachable = await tx.githubInstallation.findMany({
        where: { githubInstallationId: { in: ids }, status: { not: 'REMOVED' } },
        select: { organizationId: true },
      });
      const accessibleOrgIds = new Set(reachable.map((i) => i.organizationId));

      if (accessibleOrgIds.size > 0) {
        await tx.organizationMember.createMany({
          data: [...accessibleOrgIds].map((organizationId) => ({ organizationId, userId, role: 'MEMBER' })),
          skipDuplicates: true,
        });
      }

      const memberships = await tx.organizationMember.findMany({ where: { userId } });
      const candidates = memberships.filter((m) => !accessibleOrgIds.has(m.organizationId));
      if (candidates.length === 0) return;

      const live = await tx.githubInstallation.findMany({
        where: { organizationId: { in: candidates.map((m) => m.organizationId) }, status: { not: 'REMOVED' } },
        select: { organizationId: true },
      });
      const orgsWithLiveInstallation = new Set(live.map((i) => i.organizationId));
      const revoke = candidates.filter((m) => orgsWithLiveInstallation.has(m.organizationId)).map((m) => m.id);
      if (revoke.length > 0) await tx.organizationMember.deleteMany({ where: { id: { in: revoke } } });
    });
  }
}
