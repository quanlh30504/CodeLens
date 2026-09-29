import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import {
  EnqueueResult,
  InstallationJobData,
  RECONCILE_QUEUE,
  SYNC_QUEUE,
  reconcileJobId,
  rerunJobId,
  syncJobId,
} from './queue.names';

const jobOptions = (backoffDelayMs: number) => ({
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: backoffDelayMs },
  removeOnComplete: true,
  removeOnFail: { count: 200 },
});

/**
 * Producer side of the review-independent job queues. Both jobs only carry the GitHub
 * installation id: handlers always read authoritative state from GitHub (research R6).
 *
 * Deduplication rule, chosen so no change is ever lost:
 *  - nothing pending or running       -> add the job;
 *  - a job is waiting                 -> ALREADY_QUEUED (it will read the latest state when it runs);
 *  - a job is running                 -> add exactly one follow-up job so changes that arrived
 *                                        after the run started are picked up.
 */
export class QueueService {
  private readonly reconcile: Queue<InstallationJobData>;
  private readonly sync: Queue<InstallationJobData>;

  constructor(connection: Redis, backoffDelayMs = 5000) {
    const defaultJobOptions = jobOptions(backoffDelayMs);
    this.reconcile = new Queue<InstallationJobData>(RECONCILE_QUEUE, { connection, defaultJobOptions });
    this.sync = new Queue<InstallationJobData>(SYNC_QUEUE, { connection, defaultJobOptions });
  }

  enqueueReconcile(githubInstallationId: number, deliveryGuid?: string): Promise<EnqueueResult> {
    return this.enqueue(this.reconcile, reconcileJobId(githubInstallationId), { githubInstallationId, deliveryGuid });
  }

  enqueueSync(githubInstallationId: number, deliveryGuid?: string): Promise<EnqueueResult> {
    return this.enqueue(this.sync, syncJobId(githubInstallationId), { githubInstallationId, deliveryGuid });
  }

  async close(): Promise<void> {
    await Promise.all([this.reconcile.close(), this.sync.close()]);
  }

  private async enqueue(
    queue: Queue<InstallationJobData>,
    baseId: string,
    data: InstallationJobData,
  ): Promise<EnqueueResult> {
    const existing = await queue.getJob(baseId);
    if (!existing) {
      await queue.add(queue.name, data, { jobId: baseId });
      return 'QUEUED';
    }

    const state = await existing.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') return 'ALREADY_QUEUED';

    if (state === 'active') {
      const followUpId = rerunJobId(baseId);
      const followUp = await queue.getJob(followUpId);
      if (followUp) {
        const followUpState = await followUp.getState();
        if (followUpState === 'waiting' || followUpState === 'delayed' || followUpState === 'prioritized') {
          return 'ALREADY_QUEUED';
        }
        await followUp.remove().catch(() => undefined);
      }
      await queue.add(queue.name, data, { jobId: followUpId });
      return 'QUEUED';
    }

    // Finished (completed or failed) but still stored: replace it.
    await existing.remove().catch(() => undefined);
    await queue.add(queue.name, data, { jobId: baseId });
    return 'QUEUED';
  }
}
