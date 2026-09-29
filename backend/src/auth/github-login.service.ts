import { Inject, Injectable } from '@nestjs/common';
import { GithubError } from '../github/github-errors';
import { GithubAccessibleInstallation, GithubUserClient } from '../github/github-user.client';
import { MembershipSyncService } from '../tenancy/membership-sync.service';
import { PrismaService } from '../tenancy/prisma.service';
import { SESSION_SERVICE } from './session.guard';
import { SessionService } from './session.service';

export type LoginFailure = 'github_unavailable' | 'github_rejected';

export type LoginResult =
  | { ok: true; userId: string; cookieValue: string }
  | { ok: false; reason: LoginFailure };

/**
 * Completes GitHub sign-in: identity comes from GitHub's stable numeric user id (FR-002).
 * The user credential obtained here is used for these two calls only and then dropped (FR-034);
 * it is not stored in the database, the session or any log.
 */
@Injectable()
export class GithubLoginService {
  constructor(
    private readonly github: GithubUserClient,
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipSyncService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  async complete(code: string): Promise<LoginResult> {
    let profile;
    let accessible: GithubAccessibleInstallation[] | null = null;
    try {
      const userToken = await this.github.exchangeCode(code);
      profile = await this.github.getUser(userToken);
      // Which installations may this user see? GitHub answers; a failure here must not block sign-in.
      accessible = await this.github.listInstallations(userToken).catch((error: unknown) => {
        if (error instanceof GithubError) return null;
        throw error;
      });
    } catch (error) {
      if (error instanceof GithubError) {
        return { ok: false, reason: error.code === 'GITHUB_UNAVAILABLE' ? 'github_unavailable' : 'github_rejected' };
      }
      throw error;
    }

    const now = new Date();
    const user = await this.prisma.user.upsert({
      where: { githubUserId: profile.githubUserId },
      create: {
        githubUserId: profile.githubUserId,
        login: profile.login,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        lastLoginAt: now,
      },
      update: { login: profile.login, email: profile.email, avatarUrl: profile.avatarUrl, lastLoginAt: now },
    });

    if (accessible) await this.memberships.syncFromAccessibleInstallations(user.id, accessible);

    const { cookieValue } = await this.sessions.create(user.id);
    return { ok: true, userId: user.id, cookieValue };
  }
}
