import { Module } from '@nestjs/common';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { RateLimitModule } from '../infrastructure/rate-limit/rate-limit.module.js';
import { AppSignatureGuard } from './app-signature.guard.js';
import { CatalogService } from './catalog.service.js';
import { EventIngestService } from './event-ingest.service.js';
import { IngestController } from './ingest.controller.js';
import { SequenceMonitorService } from './sequence-monitor.service.js';

@Module({
  imports: [ConnectedAppsModule, RateLimitModule],
  controllers: [IngestController],
  providers: [AppSignatureGuard, CatalogService, EventIngestService, SequenceMonitorService],
  exports: [AppSignatureGuard, CatalogService, SequenceMonitorService],
})
export class IngestModule {}
