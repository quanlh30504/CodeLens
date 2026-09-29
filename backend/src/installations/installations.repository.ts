import { Injectable } from '@nestjs/common';
import type { GithubInstallation, Organization, Prisma, Repository } from '@prisma/client';
import { PrismaService } from '../tenancy/prisma.service';
import { TenantScope, TenantScopedRepository, notFound } from '../tenancy/tenant-scoped.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that is not a UUID cannot exist, and must look exactly like one that does not (FR-020). */
export function requireUuid(id: string): string {
  if (!UUID.test(id)) throw notFound();
  return id;
}

export type InstallationWithOrganization = GithubInstallation & { organization: Organization };

export interface RepositoryQuery {
  q?: string;
  state?: 'ENABLED' | 'DISABLED' | 'INACCESSIBLE';
  cursor?: string;
  limit: number;
}

/** All reads of installation and repository data for users go through here, with a tenant scope. */
@Injectable()
export class InstallationsRepository extends TenantScopedRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  list(scope: TenantScope): Promise<InstallationWithOrganization[]> {
    return this.prisma.githubInstallation.findMany({
      where: this.organizationFilter(scope),
      include: { organization: true },
      orderBy: [{ installedAt: 'desc' }, { id: 'asc' }],
    });
  }

  async get(scope: TenantScope, id: string): Promise<InstallationWithOrganization> {
    const row = await this.prisma.githubInstallation.findUnique({
      where: { id: requireUuid(id) },
      include: { organization: true },
    });
    return this.requireInScope(scope, row);
  }

  async accessibleCounts(installationIds: string[]): Promise<Map<string, number>> {
    const grouped = await this.prisma.repository.groupBy({
      by: ['installationId'],
      where: { installationId: { in: installationIds }, status: 'ACCESSIBLE' },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.installationId, g._count._all]));
  }

  async listRepositories(
    scope: TenantScope,
    installationId: string,
    query: RepositoryQuery,
  ): Promise<{ items: Repository[]; nextCursor: string | null }> {
    const installation = await this.get(scope, installationId);

    const where: Prisma.RepositoryWhereInput = { installationId: installation.id };
    if (query.q) where.fullName = { contains: query.q, mode: 'insensitive' };
    if (query.state === 'ENABLED') Object.assign(where, { status: 'ACCESSIBLE', reviewEnabled: true });
    if (query.state === 'DISABLED') Object.assign(where, { status: 'ACCESSIBLE', reviewEnabled: false });
    if (query.state === 'INACCESSIBLE') where.status = 'INACCESSIBLE';

    const rows = await this.prisma.repository.findMany({
      where,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: requireUuid(query.cursor) }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}
