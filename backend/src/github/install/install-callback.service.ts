import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/config.module';
import { OAUTH_STATE_SERVICE } from '../../auth/github-login.controller';
import { OAuthStateService } from '../../auth/oauth-state.service';
import { ReconcileService } from '../../installations/reconcile.service';
import { QueueService } from '../../queue/queue.service';
import { MembershipSyncService } from '../../tenancy/membership-sync.service';
import { notFound } from '../../tenancy/tenant-scoped.repository';
import { GithubAppClient } from '../github-app.client';
import { GithubError } from '../github-errors';
import { GithubUserClient } from '../github-user.client';

export interface InstallCallbackInput {
  sessionId: string;
  userId: string;
  installationId?: string;
  state?: string;
  code?: string;
  error?: string;
}

const invalidState = () =>
  new BadRequestException({ code: 'INVALID_STATE', message: 'The request could not be verified. Please start again.' });

/**
 * Handles the return from GitHub after installation (research R2, spec FR-005, FR-009).
 *
 * The installation id in the URL is attacker-controllable, so an installation is linked only after
 * GitHub itself confirms, with a short-lived credential for this user, that this user can access
 * it. The credential is used for that one check and then dropped (FR-034).
 */
@Injectable()
export class InstallCallbackService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OAUTH_STATE_SERVICE) private readonly states: OAuthStateService,
    private readonly userClient: GithubUserClient,
    private readonly appClient: GithubAppClient,
    private readonly reconcile: ReconcileService,
    private readonly memberships: MembershipSyncService,
    private readonly queues: QueueService,
  ) {}

  async handle(input: InstallCallbackInput): Promise<{ redirect: string }> {
    const { sessionId, state } = input;

    // The user declined GitHub's authorization step: nothing is linked.
    if (input.error) {
      if (!(await this.states.consume(state, ['install', 'install-confirm'], sessionId))) throw invalidState();
      return { redirect: '/installations?notice=not_confirmed' };
    }

    // Resuming after the user was sent through GitHub authorization to confirm access.
    let installationId = input.installationId;
    if (input.code && !input.installationId) {
      const resumed = await this.states.consumeWithPayload(state, 'install-confirm', sessionId);
      if (!resumed?.payload?.installationId) throw invalidState();
      installationId = resumed.payload.installationId;
    } else {
      if (!(await this.states.consume(state, 'install', sessionId))) throw invalidState();
    }

    if (!installationId || !/^\d{1,15}$/.test(installationId)) throw invalidState();
    const githubInstallationId = Number(installationId);

    // No user confirmation yet: send the user through GitHub authorization, then come back.
    if (!input.code) {
      const confirmState = await this.states.create('install-confirm', sessionId, { installationId });
      const url = new URL(`${this.config.githubWebBaseUrl}/login/oauth/authorize`);
      url.searchParams.set('client_id', this.config.githubAppClientId);
      url.searchParams.set('redirect_uri', `${this.config.publicBaseUrl}/api/installations/callback`);
      url.searchParams.set('state', confirmState);
      return { redirect: url.toString() };
    }

    let accessible;
    try {
      const userToken = await this.userClient.exchangeCode(input.code);
      accessible = await this.userClient.listInstallations(userToken);
    } catch (error) {
      if (error instanceof GithubError) return { redirect: '/installations?notice=not_confirmed' };
      throw error;
    }

    // GitHub does not list this installation for this user: reveal nothing about it (FR-009, FR-020).
    if (!accessible.some((i) => i.githubInstallationId === githubInstallationId)) throw notFound();

    let info;
    try {
      info = await this.appClient.getInstallation(githubInstallationId);
    } catch (error) {
      if (error instanceof GithubError) return { redirect: '/installations?notice=github_unavailable' };
      throw error;
    }
    if (!info) throw notFound();

    const { installation } = await this.reconcile.reconcile(githubInstallationId, info);
    if (!installation) throw notFound();
    await this.memberships.syncFromAccessibleInstallations(input.userId, accessible);
    if (installation.status === 'ACTIVE') await this.queues.enqueueSync(githubInstallationId);

    return { redirect: `/installations/${installation.id}` };
  }
}
