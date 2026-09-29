import { Injectable } from '@nestjs/common';
import { GithubError } from '../github/github-errors';
import type { AttemptInfo } from '../queue/worker-runner';
import { SyncService } from './sync.service';

/**
 * Queue handler for repository synchronization. A failure is retried by the queue (at least 3
 * times with increasing delay, FR-017); only after the last attempt is the installation shown as
 * failed, with a reason category and one audit entry.
 */
@Injectable()
export class SyncProcessor {
  constructor(private readonly sync: SyncService) {}

  async handle(data: { githubInstallationId: number }, _jobId: string, info: AttemptInfo): Promise<void> {
    try {
      await this.sync.sync(data.githubInstallationId);
    } catch (error) {
      const githubError = error instanceof GithubError ? error : new GithubError('OTHER', 'Synchronization failed');
      if (info.attempt >= info.maxAttempts) {
        await this.sync.recordFailure(data.githubInstallationId, githubError);
      }
      throw githubError;
    }
  }
}
