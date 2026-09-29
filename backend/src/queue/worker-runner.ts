import { Job, Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { InstallationJobData, RECONCILE_QUEUE, SYNC_QUEUE } from './queue.names';

export interface AttemptInfo {
  /** 1-based number of this attempt. */
  attempt: number;
  maxAttempts: number;
}

export type JobHandler = (data: InstallationJobData, jobId: string, info: AttemptInfo) => Promise<void>;

export interface JobHandlers {
  reconcile: JobHandler;
  sync: JobHandler;
}

/**
 * Runs the queue consumers. One job at a time per queue (single-instance MVP, ADR-015);
 * write phases are additionally serialized per installation by an advisory lock in the handlers.
 */
export class WorkerRunner {
  private workers: Worker<InstallationJobData>[] = [];

  constructor(
    private readonly connection: Redis,
    private readonly logger: Logger,
  ) {}

  start(handlers: JobHandlers): void {
    const wrap = (name: string, handler: JobHandler) => async (job: Job<InstallationJobData>) => {
      const log = this.logger.child({ jobId: job.id, githubInstallationId: job.data.githubInstallationId });
      log.info({ queue: name, attempt: job.attemptsMade + 1 }, 'job started');
      await handler(job.data, String(job.id), {
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
      log.info({ queue: name }, 'job finished');
    };

    this.workers = [
      new Worker<InstallationJobData>(RECONCILE_QUEUE, wrap(RECONCILE_QUEUE, handlers.reconcile), {
        connection: this.connection,
        concurrency: 1,
      }),
      new Worker<InstallationJobData>(SYNC_QUEUE, wrap(SYNC_QUEUE, handlers.sync), {
        connection: this.connection,
        concurrency: 1,
      }),
    ];
    for (const worker of this.workers) {
      worker.on('failed', (job, error) => {
        // Only the error class and message we own; never payloads.
        this.logger.warn({ jobId: job?.id, attempt: job?.attemptsMade, error: error.name }, 'job failed');
      });
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
