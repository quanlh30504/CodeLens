import type { Role } from '../auth/authorization-context';

/** What GitHub says about a user's membership of an organization (GET membership, role field). */
export interface GithubOrgMembership {
  state: 'active' | 'pending' | string;
  role: 'admin' | 'member' | 'billing_manager' | string;
}

export interface RoleInput {
  accountType: 'ORGANIZATION' | 'USER';
  accountGithubId: string;
  userGithubId: string;
  /** Null when GitHub reports no membership (for example the user only has repository access). */
  membership: GithubOrgMembership | null;
}

/**
 * Spec FR-035: OWNER is a user GitHub reports as an owner of the organization (its "admin" role),
 * or the holder of a personal account. Every other case, including billing managers, custom roles
 * and pending invitations, is MEMBER (view-only). Roles never come from who installed the app.
 */
export function mapGithubRole(input: RoleInput): Role {
  if (input.accountType === 'USER') {
    return input.userGithubId === input.accountGithubId ? 'OWNER' : 'MEMBER';
  }
  const membership = input.membership;
  return membership && membership.state === 'active' && membership.role === 'admin' ? 'OWNER' : 'MEMBER';
}
