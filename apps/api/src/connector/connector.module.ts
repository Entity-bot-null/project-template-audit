import { Module } from '@nestjs/common';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { ExplorerModule } from '../explorer/explorer.module.js';
import { RateLimitModule } from '../infrastructure/rate-limit/rate-limit.module.js';
import { IngestModule } from '../ingest/ingest.module.js';
import { ConnectorController } from './connector.controller.js';
import { ConnectorService } from './connector.service.js';

// AppSignatureGuard is built in this module's context: its dependencies come
// from ConnectedAppsModule and RateLimitModule, as in IngestModule.
@Module({
  imports: [ConnectedAppsModule, ExplorerModule, IngestModule, RateLimitModule],
  controllers: [ConnectorController],
  providers: [ConnectorService],
})
export class ConnectorModule {}
