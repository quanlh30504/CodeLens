/** State shown to the user for an installation (spec FR-041, data-model.md §Display states). */
export type DisplayState = 'SETTING_UP' | 'ACTIVE' | 'SYNC_FAILED' | 'LIMIT_REACHED' | 'SUSPENDED' | 'REMOVED';

export interface InstallationStateInput {
  status: string;
  syncStatus: string;
  syncErrorCode: string | null;
  lastSyncedAt: Date | null;
}

export function displayStateOf(i: InstallationStateInput): DisplayState {
  if (i.status === 'REMOVED') return 'REMOVED';
  if (i.status === 'SUSPENDED') return 'SUSPENDED';
  if (i.syncStatus === 'FAILED') return 'SYNC_FAILED';
  if ((i.syncStatus === 'PENDING' || i.syncStatus === 'SYNCING') && i.lastSyncedAt === null) return 'SETTING_UP';
  if (i.syncStatus === 'SYNCED' && i.syncErrorCode === 'REPOSITORY_LIMIT_EXCEEDED') return 'LIMIT_REACHED';
  return 'ACTIVE';
}

export type RepositoryDisplayState = 'ENABLED' | 'DISABLED' | 'INACCESSIBLE';

export function repositoryStateOf(r: { status: string; reviewEnabled: boolean }): RepositoryDisplayState {
  if (r.status !== 'ACCESSIBLE') return 'INACCESSIBLE';
  return r.reviewEnabled ? 'ENABLED' : 'DISABLED';
}
