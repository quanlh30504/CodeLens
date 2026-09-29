import { Injectable } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
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
  ) {}

  async handle(data: { githubInstallationId: number }): Promise<void> {
    const { installation } = await this.reconcile.reconcile(data.githubInstallationId);
    if (installation?.status === 'ACTIVE') {
      await this.queues.enqueueSync(data.githubInstallationId);
    }
  }
}
