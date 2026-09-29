import { BadRequestException, Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { GithubInstallation, Repository } from '@prisma/client';
import { AuthenticatedRequest, roleIn } from '../auth/authorization-context';
import { SessionGuard } from '../auth/session.guard';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { userScope } from '../tenancy/tenant-scoped.repository';
import { displayStateOf, repositoryStateOf } from './display-state';
import { InstallationWithOrganization, InstallationsRepository } from './installations.repository';

const STATES = new Set(['ENABLED', 'DISABLED', 'INACCESSIBLE']);

/** Read side of the installation pages. Sync internals such as sync_conflict are never returned. */
@Controller('installations')
@UseGuards(SessionGuard)
export class InstallationsController {
  constructor(
    private readonly repository: InstallationsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const scope = userScope(req.auth!.context);
    const installations = await this.repository.list(scope);
    const counts = await this.repository.accessibleCounts(installations.map((i) => i.id));
    return { items: installations.map((i) => present(i, counts.get(i.id) ?? 0, req, this.config)) };
  }

  @Get(':installationId')
  async get(@Req() req: AuthenticatedRequest, @Param('installationId') installationId: string) {
    const installation = await this.repository.get(userScope(req.auth!.context), installationId);
    const counts = await this.repository.accessibleCounts([installation.id]);
    return present(installation, counts.get(installation.id) ?? 0, req, this.config);
  }

  @Get(':installationId/repositories')
  async repositories(
    @Req() req: AuthenticatedRequest,
    @Param('installationId') installationId: string,
    @Query('q') q?: string,
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    if (state !== undefined && !STATES.has(state)) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Unknown state filter.' });
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'limit must be between 1 and 100.' });
    }
    const result = await this.repository.listRepositories(userScope(req.auth!.context), installationId, {
      q: q?.slice(0, 100) || undefined,
      state: state as 'ENABLED' | 'DISABLED' | 'INACCESSIBLE' | undefined,
      cursor,
      limit: parsedLimit,
    });
    return { items: result.items.map(presentRepository), nextCursor: result.nextCursor };
  }
}

function present(i: InstallationWithOrganization, repositoryCount: number, req: AuthenticatedRequest, config: AppConfig) {
  return {
    id: i.id,
    status: i.status,
    syncStatus: i.syncStatus,
    syncErrorCode: i.syncErrorCode,
    displayState: displayStateOf(i),
    repositorySelection: i.repositorySelection,
    installedAt: i.installedAt.toISOString(),
    lastSyncedAt: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
    repositoryCount,
    organization: { id: i.organization.id, login: i.organization.login, accountType: i.organization.accountType },
    canManage: roleIn(req.auth!.context, i.organizationId) === 'OWNER',
    githubSettingsUrl: githubSettingsUrl(config, i),
  };
}

/** Where the owner changes repository access: GitHub's own installation settings (FR-006). */
function githubSettingsUrl(config: AppConfig, i: InstallationWithOrganization): string {
  const base = config.githubWebBaseUrl;
  const id = i.githubInstallationId.toString();
  return i.organization.accountType === 'ORGANIZATION'
    ? `${base}/organizations/${encodeURIComponent(i.organization.login)}/settings/installations/${id}`
    : `${base}/settings/installations/${id}`;
}

export function presentRepository(r: Repository) {
  return {
    id: r.id,
    fullName: r.fullName,
    defaultBranch: r.defaultBranch,
    private: r.private,
    state: repositoryStateOf(r),
    enabledAt: r.enabledAt ? r.enabledAt.toISOString() : null,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
  };
}

export type { GithubInstallation };
