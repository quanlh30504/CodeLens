import { Global, Module } from '@nestjs/common';
import { InstallCallbackService } from '../github/install/install-callback.service';
import { InstallController } from '../github/install/install.controller';
import { SyncProcessor } from '../repositories/sync.processor';
import { SyncService } from '../repositories/sync.service';
import { MembershipSyncService } from '../tenancy/membership-sync.service';
import { OrganizationsService } from '../tenancy/organizations.service';
import { InstallationsController } from './installations.controller';
import { InstallationsRepository } from './installations.repository';
import { ReconcileProcessor } from './reconcile.processor';
import { ReconcileService } from './reconcile.service';

@Global()
@Module({
  // InstallController first: its literal routes (`new`, `callback`) must match before `:installationId`.
  controllers: [InstallController, InstallationsController],
  providers: [
    OrganizationsService,
    MembershipSyncService,
    ReconcileService,
    ReconcileProcessor,
    SyncService,
    SyncProcessor,
    InstallCallbackService,
    InstallationsRepository,
  ],
  exports: [OrganizationsService, MembershipSyncService, ReconcileService, ReconcileProcessor, SyncService, SyncProcessor],
})
export class InstallationsModule {}
