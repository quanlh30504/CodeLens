import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { PrismaService } from '../tenancy/prisma.service';
import { GithubLoginController } from './github-login.controller';
import type { AuthenticatedRequest } from './authorization-context';
import { clearSessionCookie, parseCookies } from './cookies';
import { CsrfGuard } from './csrf.guard';
import { SESSION_SERVICE, SessionGuard } from './session.guard';
import { SESSION_COOKIE_NAME, SessionService } from './session.service';

@Controller()
export class MeController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly login: GithubLoginController,
  ) {}

  /** The signed-in user, their organizations and roles, and the per-session CSRF token. */
  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const auth = req.auth!;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.context.userId } });
    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: auth.context.memberships.map((m) => m.organizationId) } },
      orderBy: { login: 'asc' },
    });
    return {
      id: user.id,
      login: user.login,
      avatarUrl: user.avatarUrl,
      csrfToken: auth.session.csrfToken,
      organizations: organizations.map((organization) => ({
        id: organization.id,
        login: organization.login,
        role: auth.context.memberships.find((m) => m.organizationId === organization.id)!.role,
      })),
    };
  }

  /**
   * "Refresh access": send the user through GitHub authorization again so their installations
   * and roles are re-read from GitHub. It changes nothing by itself (it only redirects), so it is a
   * plain GET; the sign-in callback then replaces the session.
   */
  @Get('me/refresh-access')
  @UseGuards(SessionGuard)
  async refreshAccess(@Res() res: Response): Promise<void> {
    await this.login.startAuthorization(res);
  }

  /** Ends the session on the server; the cookie value stops working immediately (FR-004). */
  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(SessionGuard, CsrfGuard)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.destroy(parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]);
    clearSessionCookie(res, this.config.publicBaseUrl.startsWith('https://'));
  }
}
