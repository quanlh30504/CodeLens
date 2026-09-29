export const RECONCILE_QUEUE = 'reconcile-installation';
export const SYNC_QUEUE = 'sync-repositories';

export interface InstallationJobData {
  githubInstallationId: number;
  /** Webhook delivery that caused this job, so its record can be marked processed or failed. */
  deliveryGuid?: string;
}

/**
 * Deterministic job ids make identical pending jobs collapse (spec FR-029, research R6).
 * BullMQ rejects ':' in custom ids, so the documented `reconcile:<id>` / `sync:<id>` keys are
 * written with '-'.
 */
export const reconcileJobId = (githubInstallationId: number): string => `reconcile-${githubInstallationId}`;
export const syncJobId = (githubInstallationId: number): string => `sync-${githubInstallationId}`;
export const rerunJobId = (baseId: string): string => `${baseId}-rerun`;

export type EnqueueResult = 'QUEUED' | 'ALREADY_QUEUED';
