import { Injectable } from '@nestjs/common';
import type { GithubInstallation, Prisma, Repository } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { GithubAppClient, GithubRepositoryInfo } from '../github/github-app.client';
import { GithubError } from '../github/github-errors';
import { failed, synced, syncing } from '../installations/installation-sync-status';
import { log } from '../observability/app-logger';
import { SystemContext } from '../queue/system-context';
import { METRIC, Metrics } from '../observability/metrics';
import { PrismaService } from '../tenancy/prisma.service';

/** Spec FR-011: installations are fully supported up to this many repositories. */
export const REPOSITORY_LIMIT = 5000;


export interface SyncOutcome {
  status: 'SYNCED' | 'SKIPPED';
  created: number;
  updated: number;
  markedInaccessible: number;
  reassigned: number;
  limitReached: boolean;
}

/**
 * Repository synchronization (FR-011 to FR-017, research R7).
 *
 *  - Repositories are matched by GitHub's stable repository id, never by name, so a rename
 *    updates the same row and a repeat run against unchanged GitHub state changes nothing.
 *  - GitHub is read first (outside the transaction); a failed read leaves stored data untouched.
 *  - The write phase is one transaction, serialized per installation with an advisory lock.
 *  - New repositories start disabled; repositories GitHub stops reporting become inaccessible
 *    and disabled; a repository that returns must be enabled again (FR-015).
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubAppClient,
    private readonly audit: AuditService,
    private readonly metrics: Metrics,
  ) {}

  /** Runs one synchronization. Throws GithubError on failure after recording nothing but the status. */
  async sync(githubInstallationId: number): Promise<SyncOutcome> {
    const startedAt = Date.now();
    const id = BigInt(githubInstallationId);
    const installation = await this.prisma.githubInstallation.findUnique({ where: { githubInstallationId: id } });
    if (!installation || installation.status !== 'ACTIVE') {
      // Removed, suspended or unknown installations are never synchronized (FR-024, FR-025).
      return { status: 'SKIPPED', created: 0, updated: 0, markedInaccessible: 0, reassigned: 0, limitReached: false };
    }

    await this.prisma.githubInstallation.update({ where: { id: installation.id }, data: syncing() });

    const { repositories: fetched, truncated } = await this.github.listInstallationRepositories(
      githubInstallationId,
      REPOSITORY_LIMIT,
    );
    const takeOver = await this.decideTakeOvers(installation, fetched);

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id}::bigint)`;
        const applied = await this.apply(tx, installation, fetched, takeOver);
        await tx.githubInstallation.update({
          where: { id: installation.id },
          data: synced(truncated, new Date()),
        });
        return { ...applied, status: 'SYNCED' as const, limitReached: truncated };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    this.metrics.increment(METRIC.syncCompleted);
    this.metrics.observe(METRIC.syncDurationMs, Date.now() - startedAt);
    log().info(
      { githubInstallationId, repositories: fetched.length, created: outcome.created, updated: outcome.updated, durationMs: Date.now() - startedAt },
      'repository synchronization finished',
    );
    return outcome;
  }

  /** Records the final failure of a synchronization (called after the last retry). */
  async recordFailure(githubInstallationId: number, error: GithubError): Promise<void> {
    this.metrics.increment(METRIC.syncFailed);
    const installation = await this.prisma.githubInstallation.findUnique({
      where: { githubInstallationId: BigInt(githubInstallationId) },
    });
    if (!installation) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.githubInstallation.update({ where: { id: installation.id }, data: failed(error.code) });
      await this.audit.record(
        {
          organizationId: installation.organizationId,
          action: 'REPOSITORY_SYNC_FAILED',
          resourceType: 'GITHUB_INSTALLATION',
          resourceId: installation.id,
          metadata: { reason: error.code },
        },
        tx,
      );
    });
  }

  /**
   * For repositories that are already stored under another installation (a transfer, research R7):
   * ask GitHub whether that holder still has access. Returns the GitHub ids that move to this
   * installation; the others stay with their holder and are flagged for operators only.
   */
  private async decideTakeOvers(
    installation: GithubInstallation,
    fetched: GithubRepositoryInfo[],
  ): Promise<{ move: Set<bigint>; conflict: Set<bigint> }> {
    const ids = fetched.map((r) => BigInt(r.githubRepositoryId));
    const foreign = await this.prisma.repository.findMany({
      where: { githubRepositoryId: { in: ids }, installationId: { not: installation.id } },
      include: { installation: true },
    });
    const move = new Set<bigint>();
    const conflict = new Set<bigint>();
    const holderCache = new Map<string, Set<number> | 'unknown'>();

    for (const row of foreign) {
      const holder = row.installation;
      if (holder.status !== 'ACTIVE') {
        move.add(row.githubRepositoryId);
        continue;
      }
      let holderIds = holderCache.get(holder.id);
      if (!holderIds) {
        try {
          const list = await this.github.listInstallationRepositories(Number(holder.githubInstallationId), Number.MAX_SAFE_INTEGER);
          holderIds = new Set(list.repositories.map((r) => r.githubRepositoryId));
        } catch {
          holderIds = 'unknown';
        }
        holderCache.set(holder.id, holderIds);
      }
      // If we cannot tell, the current holder keeps the repository.
      if (holderIds !== 'unknown' && !holderIds.has(Number(row.githubRepositoryId))) move.add(row.githubRepositoryId);
      else conflict.add(row.githubRepositoryId);
    }
    return { move, conflict };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    installation: GithubInstallation,
    fetched: GithubRepositoryInfo[],
    takeOver: { move: Set<bigint>; conflict: Set<bigint> },
  ): Promise<Omit<SyncOutcome, 'status' | 'limitReached'>> {
    const now = new Date();
    const context = SystemContext.forInstallation(installation);
    const fetchedIds = new Set(fetched.map((r) => BigInt(r.githubRepositoryId)));
    const stored = await tx.repository.findMany({
      where: { OR: [{ installationId: installation.id }, { githubRepositoryId: { in: [...fetchedIds] } }] },
    });
    const byGithubId = new Map<bigint, Repository>(stored.map((r) => [r.githubRepositoryId, r]));

    // 1. Free names that are about to change hands, so renames, swaps and delete/recreate cannot
    //    collide with the unique full_name (a temporary placeholder is replaced in step 3).
    const finalNames = new Map(fetched.map((r) => [BigInt(r.githubRepositoryId), r.fullName]));
    const holdsWantedName = await tx.repository.findMany({ where: { fullName: { in: fetched.map((r) => r.fullName) } } });
    const needsFreeing = new Set<bigint>();
    const isMine = (row: Repository) => row.installationId === installation.id || takeOver.move.has(row.githubRepositoryId);
    for (const row of stored) {
      const wanted = finalNames.get(row.githubRepositoryId);
      if (wanted !== undefined && wanted !== row.fullName && isMine(row)) needsFreeing.add(row.githubRepositoryId);
    }
    for (const row of holdsWantedName) {
      // A stale repository (not reported by this installation) holding a wanted name gives it up.
      if (!finalNames.has(row.githubRepositoryId)) needsFreeing.add(row.githubRepositoryId);
    }
    for (const githubId of needsFreeing) {
      await tx.repository.update({ where: { githubRepositoryId: githubId }, data: { fullName: `~${githubId}` } });
      const row = byGithubId.get(githubId);
      if (row) row.fullName = `~${githubId}`;
    }

    // 2. Repositories this installation no longer reports become inaccessible and disabled.
    let markedInaccessible = 0;
    for (const row of stored) {
      if (row.installationId !== installation.id || fetchedIds.has(row.githubRepositoryId)) continue;
      context.assertOwns(row);
      if (row.status !== 'INACCESSIBLE' || row.reviewEnabled) {
        await tx.repository.update({
          where: { id: row.id },
          data: { status: 'INACCESSIBLE', reviewEnabled: false, enabledAt: null, enabledByUserId: null, lastSyncedAt: now },
        });
        markedInaccessible += 1;
      }
    }

    // 3. Create, update or move what GitHub reports.
    let created = 0;
    let updated = 0;
    let reassigned = 0;
    const toCreate: Prisma.RepositoryCreateManyInput[] = [];

    for (const repo of fetched) {
      const githubId = BigInt(repo.githubRepositoryId);
      const row = byGithubId.get(githubId);
      const fields = {
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
      };

      if (!row) {
        context.assertWritesTo(installation.organizationId);
        toCreate.push({
          organizationId: installation.organizationId,
          installationId: installation.id,
          githubRepositoryId: githubId,
          ...fields,
          status: 'ACCESSIBLE',
          reviewEnabled: false,
          lastSyncedAt: now,
        });
        created += 1;
        continue;
      }

      if (row.installationId !== installation.id) {
        if (takeOver.move.has(githubId)) {
          context.assertWritesTo(installation.organizationId);
          await tx.repository.update({
            where: { id: row.id },
            data: {
              ...fields,
              organizationId: installation.organizationId,
              installationId: installation.id,
              status: 'ACCESSIBLE',
              // A transferred repository carries none of the former tenant's settings.
              reviewEnabled: false,
              enabledAt: null,
              enabledByUserId: null,
              syncConflict: false,
              lastSyncedAt: now,
            },
          });
          reassigned += 1;
        } else if (!row.syncConflict) {
          await tx.repository.update({ where: { id: row.id }, data: { syncConflict: true } });
          log().warn({ githubRepositoryId: githubId.toString() }, 'repository reported by two installations');
        }
        continue;
      }

      context.assertOwns(row);
      const changed =
        row.owner !== fields.owner ||
        row.name !== fields.name ||
        row.fullName !== fields.fullName ||
        row.defaultBranch !== fields.defaultBranch ||
        row.private !== fields.private ||
        row.status !== 'ACCESSIBLE' ||
        row.syncConflict;
      if (changed) {
        await tx.repository.update({
          where: { id: row.id },
          data: {
            ...fields,
            status: 'ACCESSIBLE',
            // A repository that returns after being removed must be enabled again.
            reviewEnabled: row.status === 'ACCESSIBLE' ? row.reviewEnabled : false,
            syncConflict: false,
            lastSyncedAt: now,
          },
        });
        updated += 1;
      }
    }
    if (toCreate.length > 0) {
      for (let i = 0; i < toCreate.length; i += 1000) {
        await tx.repository.createMany({ data: toCreate.slice(i, i + 1000) });
      }
    }

    return { created, updated, markedInaccessible, reassigned };
  }
}
