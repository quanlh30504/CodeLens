import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { MEMBERSHIP_SOURCE } from '../auth/session.guard';
import { PrismaMembershipSource } from './membership.source';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    AuditService,
    PrismaMembershipSource,
    { provide: MEMBERSHIP_SOURCE, useExisting: PrismaMembershipSource },
  ],
  exports: [PrismaService, AuditService, MEMBERSHIP_SOURCE],
})
export class TenancyModule {}
