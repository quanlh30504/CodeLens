import { NotFoundException } from '@nestjs/common';
import { AuthorizationContext, organizationIdsOf } from '../auth/authorization-context';

/**
 * Who a data access acts for. There is deliberately no unscoped variant:
 *  - a user request carries the caller's AuthorizationContext;
 *  - background work (webhook processing, synchronization) runs under an explicit system scope
 *    bound to exactly one organization (the installation's), never to "all".
 */
export type TenantScope =
  | { kind: 'user'; context: AuthorizationContext }
  | { kind: 'system'; organizationId: string };

export const notFound = (): NotFoundException =>
  // Same body for "does not exist" and "belongs to another organization" (FR-020).
  new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

export function userScope(context: AuthorizationContext): TenantScope {
  return { kind: 'user', context };
}

export function systemScope(organizationId: string): TenantScope {
  if (!organizationId) throw new Error('A system scope must be bound to one organization');
  return { kind: 'system', organizationId };
}

/** Base class for repositories of tenant data. Concrete repositories take a TenantScope in every method. */
export abstract class TenantScopedRepository {
  /** Organization ids the scope may read or write. */
  protected allowedOrganizationIds(scope: TenantScope): string[] {
    return scope.kind === 'user' ? organizationIdsOf(scope.context) : [scope.organizationId];
  }

  /** Prisma `where` fragment restricting a query to the scope. */
  protected organizationFilter(scope: TenantScope): { organizationId: { in: string[] } } {
    return { organizationId: { in: this.allowedOrganizationIds(scope) } };
  }

  /** Throws the standard not-found error unless the organization is inside the scope. */
  protected assertInScope(scope: TenantScope, organizationId: string): void {
    if (!this.allowedOrganizationIds(scope).includes(organizationId)) throw notFound();
  }

  /** Returns the value, or throws the standard not-found error when the row is missing or out of scope. */
  protected requireInScope<T extends { organizationId: string }>(scope: TenantScope, row: T | null | undefined): T {
    if (!row) throw notFound();
    this.assertInScope(scope, row.organizationId);
    return row;
  }
}
