import type { Prisma } from '@prisma/client';
import type { GithubErrorCode } from '../github/github-errors';

/** The only values ever stored in github_installations.sync_error_code (spec FR-041). */
export type SyncErrorCode = GithubErrorCode | 'REPOSITORY_LIMIT_EXCEEDED';

export const SYNC_ERROR_CODES: readonly SyncErrorCode[] = [
  'GITHUB_UNAVAILABLE',
  'GITHUB_RATE_LIMITED',
  'ACCESS_REVOKED',
  'OTHER',
  'REPOSITORY_LIMIT_EXCEEDED',
];

/**
 * sync_status: PENDING -> SYNCING -> SYNCED | FAILED, and back to SYNCING on retry or new event.
 * Only codes are stored, never GitHub text.
 */
export const syncing = (): Prisma.GithubInstallationUpdateInput => ({ syncStatus: 'SYNCING' });

export const synced = (limitReached: boolean, at: Date): Prisma.GithubInstallationUpdateInput => ({
  syncStatus: 'SYNCED',
  syncErrorCode: limitReached ? 'REPOSITORY_LIMIT_EXCEEDED' : null,
  lastSyncedAt: at,
});

export const failed = (code: GithubErrorCode): Prisma.GithubInstallationUpdateInput => ({
  syncStatus: 'FAILED',
  syncErrorCode: code,
});
