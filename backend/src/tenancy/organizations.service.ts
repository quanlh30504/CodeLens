import { Injectable } from '@nestjs/common';
import type { Organization, Prisma } from '@prisma/client';
import type { GithubInstallationInfo } from '../github/github-app.client';
import { PrismaService } from './prisma.service';

/**
 * Organizations are the tenants (FR-008). One row per GitHub organization or personal account,
 * keyed by GitHub's stable account id, so a reinstall lands in the same organization.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  upsertFromAccount(
    account: GithubInstallationInfo['account'],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Organization> {
    return db.organization.upsert({
      where: { githubOrgId: account.githubId },
      create: {
        githubOrgId: account.githubId,
        accountType: account.type,
        login: account.login,
        avatarUrl: account.avatarUrl,
      },
      update: { accountType: account.type, login: account.login, avatarUrl: account.avatarUrl },
    });
  }
}
