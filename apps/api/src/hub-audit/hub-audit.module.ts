import { Global, Module } from '@nestjs/common';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { HubAuditService } from './hub-audit.service.js';

// Audit Hub's own audit trail: global, so any feature records what its
// people do without importing anything.
@Global()
@Module({
  imports: [ConnectedAppsModule],
  providers: [HubAuditService],
  exports: [HubAuditService],
})
export class HubAuditModule {}
