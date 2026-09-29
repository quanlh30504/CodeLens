import { Injectable } from '@nestjs/common';
import type { GithubInstallation, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { GithubAppClient, GithubInstallationInfo } from '../github/github-app.client';
import { OrganizationsService } from '../tenancy/organizations.service';
import { PrismaService } from '../tenancy/prisma.service';
import { recordInstallationTransition } from './installation-audit';

export interface ReconcileResult {
  /** Null when GitHub does not know the installation and CodeLens never recorded it either. */
  installation: GithubInstallation | null;
  created: boolean;
}

/**
 * Brings CodeLens's record of one installation in line with what GitHub reports (research R6).
 * Events and callbacks only say "look at installation N"; the state is always read from GitHub,
 * so duplicate, late and out-of-order events converge to the same result (FR-029, FR-030).
 *
 * Handles: first sight (ACTIVE), suspend/unsuspend, uninstall (GitHub answers not found) and
 * reinstall (a new GitHub installation id under the same organization, FR-026).
 */
@Injectable()
export class ReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubAppClient,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
  ) {}

  /** `prefetched` lets the install callback pass what it already read; undefined means "ask GitHub". */
  async reconcile(githubInstallationId: number, prefetched?: GithubInstallationInfo | null): Promise<ReconcileResult> {
    const info = prefetched === undefined ? await this.github.getInstallation(githubInstallationId) : prefetched;
    const id = BigInt(githubInstallationId);

    return this.prisma.$transaction(async (tx) => {
      // One write phase per installation, shared with the repository synchronization.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id}::bigint)`;
      const existing = await tx.githubInstallation.findUnique({ where: { githubInstallationId: id } });

      if (info === null) return this.markRemoved(tx, existing);
      return this.upsertFromGithub(tx, existing, info);
    });
  }

  private async markRemoved(tx: Prisma.TransactionClient, existing: GithubInstallation | null): Promise<ReconcileResult> {
    if (!existing) return { installation: null, created: false };
    if (existing.status === 'REMOVED') return { installation: existing, created: false };

    const removed = await tx.githubInstallation.update({
      where: { id: existing.id },
      data: { status: 'REMOVED', removedAt: new Date(), suspendedAt: null },
    });
    // Everything reached through this installation stops being eligible (FR-024).
    await tx.repository.updateMany({
      where: { installationId: existing.id },
      data: { status: 'INACCESSIBLE', reviewEnabled: false },
    });
    await recordInstallationTransition(this.audit, tx, {
      organizationId: existing.organizationId,
      installationId: existing.id,
      action: 'GITHUB_INSTALLATION_REMOVED',
      githubInstallationId: existing.githubInstallationId,
      accountLogin: existing.accountLogin,
    });
    return { installation: removed, created: false };
  }

  private async upsertFromGithub(
    tx: Prisma.TransactionClient,
    existing: GithubInstallation | null,
    info: GithubInstallationInfo,
  ): Promise<ReconcileResult> {
    const organization = await this.organizations.upsertFromAccount(info.account, tx);
    const desiredStatus = info.suspendedAt ? 'SUSPENDED' : 'ACTIVE';

    if (!existing) {
      const created = await tx.githubInstallation.create({
        data: {
          organizationId: organization.id,
          githubInstallationId: BigInt(info.githubInstallationId),
          accountType: info.account.type,
          accountLogin: info.account.login,
          status: desiredStatus,
          repositorySelection: info.repositorySelection,
          installedAt: info.installedAt,
          suspendedAt: info.suspendedAt,
        },
      });
      await recordInstallationTransition(this.audit, tx, {
        organizationId: organization.id,
        installationId: created.id,
        action: 'GITHUB_INSTALLATION_ADDED',
        githubInstallationId: created.githubInstallationId,
        accountLogin: created.accountLogin,
      });
      if (desiredStatus === 'SUSPENDED') {
        await recordInstallationTransition(this.audit, tx, {
          organizationId: organization.id,
          installationId: created.id,
          action: 'GITHUB_INSTALLATION_SUSPENDED',
          githubInstallationId: created.githubInstallationId,
          accountLogin: created.accountLogin,
        });
      }
      return { installation: created, created: true };
    }

    const data: Prisma.GithubInstallationUpdateInput = {};
    if (existing.accountLogin !== info.account.login) data.accountLogin = info.account.login;
    if (existing.repositorySelection !== info.repositorySelection) data.repositorySelection = info.repositorySelection;
    if (existing.status !== desiredStatus) {
      data.status = desiredStatus;
      data.suspendedAt = info.suspendedAt;
      data.removedAt = null;
    }
    const updated = Object.keys(data).length
      ? await tx.githubInstallation.update({ where: { id: existing.id }, data })
      : existing;

    if (existing.status !== desiredStatus) {
      const action =
        desiredStatus === 'SUSPENDED'
          ? 'GITHUB_INSTALLATION_SUSPENDED'
          : existing.status === 'SUSPENDED'
            ? 'GITHUB_INSTALLATION_UNSUSPENDED'
            : 'GITHUB_INSTALLATION_ADDED';
      await recordInstallationTransition(this.audit, tx, {
        organizationId: existing.organizationId,
        installationId: existing.id,
        action,
        githubInstallationId: existing.githubInstallationId,
        accountLogin: updated.accountLogin,
      });
    }
    return { installation: updated, created: false };
  }
}
