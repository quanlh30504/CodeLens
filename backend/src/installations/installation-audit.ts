import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditService } from '../audit/audit.service';

/**
 * Lifecycle audit entries (spec FR-027). They are written inside the same transaction as the
 * state change and only on an actual transition, so a repeated event or a repeated
 * synchronization can never add a second entry for the same transition.
 */
export async function recordInstallationTransition(
  audit: AuditService,
  tx: Prisma.TransactionClient,
  entry: {
    organizationId: string;
    installationId: string;
    action: Extract<
      AuditAction,
      | 'GITHUB_INSTALLATION_ADDED'
      | 'GITHUB_INSTALLATION_REMOVED'
      | 'GITHUB_INSTALLATION_SUSPENDED'
      | 'GITHUB_INSTALLATION_UNSUSPENDED'
    >;
    githubInstallationId: bigint;
    accountLogin: string;
  },
): Promise<void> {
  await audit.record(
    {
      organizationId: entry.organizationId,
      action: entry.action,
      resourceType: 'GITHUB_INSTALLATION',
      resourceId: entry.installationId,
      metadata: { githubInstallationId: entry.githubInstallationId.toString(), account: entry.accountLogin },
    },
    tx,
  );
}
