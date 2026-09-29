import type { GithubInstallation } from '@prisma/client';
import { TenantScope, notFound, systemScope } from '../tenancy/tenant-scoped.repository';

/**
 * The identity background work runs under (spec FR-009). Worker jobs are authorized by the
 * installation only, and that resolves to exactly one organization: the installation's own.
 * Everything a job writes is checked against that organization before it is written, so a bug
 * cannot make synchronization touch another tenant's data.
 */
export class SystemContext {
  readonly scope: TenantScope;

  private constructor(readonly organizationId: string) {
    this.scope = systemScope(organizationId);
  }

  static forInstallation(installation: Pick<GithubInstallation, 'organizationId'>): SystemContext {
    return new SystemContext(installation.organizationId);
  }

  /** Throws the standard not-found error if a row belongs to another organization. */
  assertOwns(row: { organizationId: string }): void {
    if (row.organizationId !== this.organizationId) throw notFound();
  }

  /** Data about to be written must name this context's organization. */
  assertWritesTo(organizationId: string): void {
    if (organizationId !== this.organizationId) throw notFound();
  }
}
