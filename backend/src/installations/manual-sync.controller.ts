import { ConflictException, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CsrfGuard } from '../auth/csrf.guard';
import { Managed, RoleFreshnessGuard } from '../auth/role-freshness.guard';
import { SessionGuard } from '../auth/session.guard';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../tenancy/prisma.service';

@Controller('installations')
export class ManualSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Owners can re-run the repository import at any time (FR-016). Safe to repeat: the job id is
   * deterministic, so many requests collapse into one waiting job.
   */
  @Post(':installationId/sync')
  @HttpCode(202)
  @UseGuards(SessionGuard, CsrfGuard, RoleFreshnessGuard)
  @Managed('installation', 'installationId')
  async sync(@Param('installationId') installationId: string) {
    const installation = await this.prisma.githubInstallation.findUniqueOrThrow({ where: { id: installationId } });
    if (installation.status !== 'ACTIVE') {
      throw new ConflictException({ code: 'CONFLICT', message: 'This installation is not active on GitHub.' });
    }
    const status = await this.queues.enqueueSync(Number(installation.githubInstallationId));
    return { status };
  }
}
