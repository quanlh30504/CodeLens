import { ConflictException, Injectable } from '@nestjs/common';
import type { Repository } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../tenancy/prisma.service';
import { notFound } from '../tenancy/tenant-scoped.repository';

/**
 * Enables or disables review for one repository (FR-021, FR-023). The change is a compare-and-set
 * inside a transaction, so repeating a request or racing two requests ends in the state of the
 * last one, with exactly one audit entry per real change.
 */
@Injectable()
export class ReviewEnabledService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async set(repositoryId: string, enabled: boolean, actorUserId: string): Promise<Repository> {
    return this.prisma.$transaction(async (tx) => {
      const repository = await tx.repository.findUnique({ where: { id: repositoryId } });
      if (!repository) throw notFound();

      // An inaccessible repository can never be enabled (also enforced by a database check).
      if (enabled && repository.status !== 'ACCESSIBLE') {
        throw new ConflictException({ code: 'CONFLICT', message: 'This repository is no longer accessible on GitHub.' });
      }

      const changed = await tx.repository.updateMany({
        where: { id: repositoryId, reviewEnabled: !enabled },
        data: enabled
          ? { reviewEnabled: true, enabledAt: new Date(), enabledByUserId: actorUserId }
          : { reviewEnabled: false, enabledAt: null, enabledByUserId: null },
      });
      if (changed.count === 1) {
        await this.audit.record(
          {
            organizationId: repository.organizationId,
            userId: actorUserId,
            action: enabled ? 'REPOSITORY_ENABLED' : 'REPOSITORY_DISABLED',
            resourceType: 'REPOSITORY',
            resourceId: repository.id,
            metadata: { repository: repository.fullName },
          },
          tx,
        );
      }
      return tx.repository.findUniqueOrThrow({ where: { id: repositoryId } });
    });
  }
}
