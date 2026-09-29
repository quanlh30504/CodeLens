import { BadRequestException, Body, Controller, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/authorization-context';
import { CsrfGuard } from '../auth/csrf.guard';
import { Managed, RoleFreshnessGuard } from '../auth/role-freshness.guard';
import { SessionGuard } from '../auth/session.guard';
import { presentRepository } from '../installations/installations.controller';
import { ReviewEnabledService } from './review-enabled.service';

const body = z.object({ enabled: z.boolean() }).strict();

@Controller('repositories')
export class ReviewEnabledController {
  constructor(private readonly service: ReviewEnabledService) {}

  /** Owners only, with a role confirmed by GitHub within 10 minutes (RoleFreshnessGuard). */
  @Put(':repositoryId/review-enabled')
  @HttpCode(200)
  @UseGuards(SessionGuard, CsrfGuard, RoleFreshnessGuard)
  @Managed('repository', 'repositoryId')
  async set(@Req() req: AuthenticatedRequest, @Param('repositoryId') repositoryId: string, @Body() payload: unknown) {
    const parsed = body.safeParse(payload);
    if (!parsed.success) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Body must be {"enabled": true|false}.' });
    const repository = await this.service.set(repositoryId, parsed.data.enabled, req.auth!.context.userId);
    return presentRepository(repository);
  }
}
