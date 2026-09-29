import { Injectable } from '@nestjs/common';
import { GithubError } from '../github/github-errors';
import { WebhookDeliveriesService } from '../github/webhook/webhook-deliveries.service';
import { QueueService } from '../queue/queue.service';
import type { AttemptInfo } from '../queue/worker-runner';
import { ReconcileService } from './reconcile.service';

/**
 * Queue handler for "look at installation N". Reads GitHub, updates the installation, and queues
 * a repository synchronization when the installation is active.
 */
@Injectable()
export class ReconcileProcessor {
  constructor(
    private readonly reconcile: ReconcileService,
    private readonly queues: QueueService,
    private readonly deliveries: WebhookDeliveriesService,
  ) {}

  async handle(data: { githubInstallationId: number; deliveryGuid?: string }, _jobId?: string, info?: AttemptInfo): Promise<void> {
    try {
      const { installation } = await this.reconcile.reconcile(data.githubInstallationId);
      if (installation?.status === 'ACTIVE') {
        await this.queues.enqueueSync(data.githubInstallationId);
      }
      await this.deliveries.markProcessed(data.deliveryGuid);
    } catch (error) {
      // The delivery is marked failed only after the queue's last attempt; earlier attempts retry.
      if (!info || info.attempt >= info.maxAttempts) {
        await this.deliveries.markFailed(data.deliveryGuid, error instanceof GithubError ? error.code : 'OTHER');
      }
      throw error;
    }
  }
}
