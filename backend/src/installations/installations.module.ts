import { Global, Module } from '@nestjs/common';
import { InstallCallbackService } from '../github/install/install-callback.service';
import { InstallController } from '../github/install/install.controller';
import { RoleFreshnessGuard } from '../auth/role-freshness.guard';
import { ReviewEligibilityService } from '../repositories/review-eligibility';
import { ReviewEnabledController } from '../repositories/review-enabled.controller';
import { ReviewEnabledService } from '../repositories/review-enabled.service';
import { SyncProcessor } from '../repositories/sync.processor';
import { SyncService } from '../repositories/sync.service';
import { MembershipSyncService } from '../tenancy/membership-sync.service';
import { OrganizationsService } from '../tenancy/organizations.service';
import { InstallationsController } from './installations.controller';
import { ManualSyncController } from './manual-sync.controller';
import { InstallationsRepository } from './installations.repository';
import { ReconcileProcessor } from './reconcile.processor';
import { ReconcileService } from './reconcile.service';

@Global()
@Module({
  // InstallController first: its literal routes (`new`, `callback`) must match before `:installationId`.
  controllers: [InstallController, InstallationsController, ManualSyncController, ReviewEnabledController],
  providers: [
    OrganizationsService,
    MembershipSyncService,
    ReconcileService,
    ReconcileProcessor,
    SyncService,
    SyncProcessor,
    InstallCallbackService,
    InstallationsRepository,
    ReviewEnabledService,
    ReviewEligibilityService,
    RoleFreshnessGuard,
  ],
  exports: [OrganizationsService, MembershipSyncService, ReconcileService, ReconcileProcessor, SyncService, SyncProcessor, ReviewEligibilityService],
})
export class InstallationsModule {}
