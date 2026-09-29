import type { Request } from 'express';
import type { SessionData } from './session.service';

export type Role = 'OWNER' | 'MEMBER';

export interface Membership {
  organizationId: string;
  role: Role;
  /** Last time GitHub confirmed this role; null if never confirmed (FR-036, FR-037). */
  roleVerifiedAt: Date | null;
}

/**
 * Who is asking, and for which organizations. Resolved on every authenticated request from the
 * database (never from the browser) and required by every tenant-scoped data access (FR-009).
 */
export interface AuthorizationContext {
  userId: string;
  memberships: Membership[];
}

export interface AuthenticatedRequest extends Request {
  auth?: {
    sessionId: string;
    session: SessionData;
    context: AuthorizationContext;
  };
}

export interface MembershipSource {
  findMemberships(userId: string): Promise<Membership[]>;
}

export async function resolveAuthorizationContext(
  source: MembershipSource,
  userId: string,
): Promise<AuthorizationContext> {
  return { userId, memberships: await source.findMemberships(userId) };
}

export function organizationIdsOf(context: AuthorizationContext): string[] {
  return context.memberships.map((m) => m.organizationId);
}

export function roleIn(context: AuthorizationContext, organizationId: string): Role | null {
  return context.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
}
