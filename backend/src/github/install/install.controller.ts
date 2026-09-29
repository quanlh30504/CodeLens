import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/config.module';
import type { AuthenticatedRequest } from '../../auth/authorization-context';
import { OAUTH_STATE_SERVICE } from '../../auth/github-login.controller';
import { OAuthStateService } from '../../auth/oauth-state.service';
import { SessionGuard } from '../../auth/session.guard';
import { InstallCallbackService } from './install-callback.service';

@Controller('installations')
@UseGuards(SessionGuard)
export class InstallController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OAUTH_STATE_SERVICE) private readonly states: OAuthStateService,
    private readonly callbackService: InstallCallbackService,
  ) {}

  /** Starts installation: send the user to GitHub's own installation page (FR-005, FR-006). */
  @Get('new')
  async start(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const state = await this.states.create('install', req.auth!.sessionId);
    const url = new URL(`${this.config.githubWebBaseUrl}/apps/${this.config.githubAppSlug}/installations/new`);
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }

  /** GitHub's return after installation. Nothing is linked until GitHub confirms the user can access it. */
  @Get('callback')
  async callback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('installation_id') installationId?: string,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const result = await this.callbackService.handle({
      sessionId: req.auth!.sessionId,
      userId: req.auth!.context.userId,
      installationId,
      state,
      code,
      error,
    });
    res.redirect(302, result.redirect);
  }
}
