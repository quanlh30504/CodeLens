import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { parseCookies, setSessionCookie } from './cookies';
import { GithubLoginService } from './github-login.service';
import { OAuthStateService } from './oauth-state.service';

export const OAUTH_STATE_SERVICE = Symbol('OAUTH_STATE_SERVICE');
export const LOGIN_STATE_COOKIE = 'codelens_login_state';

@Controller('auth/github')
export class GithubLoginController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OAUTH_STATE_SERVICE) private readonly states: OAuthStateService,
    private readonly login: GithubLoginService,
  ) {}

  private get secureCookies(): boolean {
    return this.config.publicBaseUrl.startsWith('https://');
  }

  /** Starts sign-in: redirect to GitHub with a single-use state that is also held in a short-lived cookie. */
  @Get('login')
  async start(@Res() res: Response): Promise<void> {
    const state = await this.states.create('login');
    res.cookie(LOGIN_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'lax',
      path: '/api/auth/github',
      maxAge: 10 * 60 * 1000,
    });
    const url = new URL(`${this.config.githubWebBaseUrl}/login/oauth/authorize`);
    url.searchParams.set('client_id', this.config.githubAppClientId);
    url.searchParams.set('redirect_uri', `${this.config.publicBaseUrl}/api/auth/github/callback`);
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }

  /** Completes sign-in. Every outcome is a redirect into the web app; no error text from GitHub is passed on. */
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const cookieState = parseCookies(req.headers.cookie)[LOGIN_STATE_COOKIE];
    res.clearCookie(LOGIN_STATE_COOKIE, { path: '/api/auth/github' });

    // The state is consumed (single use) whatever happens next.
    const stateValid = (await this.states.consume(state, 'login')) && cookieState !== undefined && cookieState === state;

    if (error) return res.redirect(302, '/sign-in?error=cancelled');
    if (!stateValid || !code) return res.redirect(302, '/sign-in?error=invalid_state');

    const result = await this.login.complete(code);
    if (!result.ok) return res.redirect(302, `/sign-in?error=${result.reason}`);

    setSessionCookie(res, result.cookieValue, this.secureCookies);
    return res.redirect(302, '/installations');
  }
}
