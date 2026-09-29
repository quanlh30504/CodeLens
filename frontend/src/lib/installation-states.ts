export type DisplayState = 'SETTING_UP' | 'ACTIVE' | 'SYNC_FAILED' | 'LIMIT_REACHED' | 'SUSPENDED' | 'REMOVED';
export type RepositoryState = 'ENABLED' | 'DISABLED' | 'INACCESSIBLE';

export interface Installation {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  syncStatus: string;
  syncErrorCode: string | null;
  displayState: DisplayState;
  repositorySelection: 'ALL' | 'SELECTED';
  installedAt: string;
  lastSyncedAt: string | null;
  repositoryCount: number;
  organization: { id: string; login: string; accountType: 'ORGANIZATION' | 'USER' };
  githubSettingsUrl: string;
  canManage: boolean;
}

export interface Repository {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  state: RepositoryState;
  enabledAt: string | null;
  lastSyncedAt: string | null;
}

/** Labels for the installation states of spec FR-041. */
export const INSTALLATION_STATE_LABELS: Record<DisplayState, string> = {
  SETTING_UP: 'Setting up',
  ACTIVE: 'Active',
  SYNC_FAILED: 'Active – synchronization failed',
  LIMIT_REACHED: 'Active – repository limit reached',
  SUSPENDED: 'Suspended',
  REMOVED: 'Removed',
};

export const REPOSITORY_STATE_LABELS: Record<RepositoryState, string> = {
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  INACCESSIBLE: 'No longer accessible',
};

/** Reason categories for a failed synchronization; GitHub's own text is never shown (FR-017). */
export const SYNC_FAILURE_REASONS: Record<string, string> = {
  GITHUB_UNAVAILABLE: 'GitHub could not be reached.',
  GITHUB_RATE_LIMITED: 'GitHub is limiting requests right now.',
  ACCESS_REVOKED: 'GitHub no longer allows CodeLens to read this installation.',
  OTHER: 'The import failed for another reason.',
};

export const REPOSITORY_LIMIT = 5000;

export function syncFailureReason(code: string | null): string {
  return (code && SYNC_FAILURE_REASONS[code]) || SYNC_FAILURE_REASONS.OTHER;
}

export function limitWarning(): string {
  return `This installation has more than ${REPOSITORY_LIMIT.toLocaleString('en-US')} repositories. CodeLens shows the first ${REPOSITORY_LIMIT.toLocaleString('en-US')}; the others are not shown.`;
}

export const NOTICE_MESSAGES: Record<string, string> = {
  not_confirmed: 'We could not confirm your access to that installation with GitHub, so nothing was linked.',
  github_unavailable: 'GitHub could not be reached, so the installation could not be confirmed. Please try again.',
};

export function noticeMessage(code: string | string[] | undefined): string | null {
  return typeof code === 'string' ? (NOTICE_MESSAGES[code] ?? null) : null;
}
