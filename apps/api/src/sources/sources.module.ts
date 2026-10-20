import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SourceHealthService } from './source-health.service.js';
import { SourcesController } from './sources.controller.js';

// The event sources' health: shared by the health rules and the SOC view.
@Module({
  imports: [AuthModule, AccessModule, AlertsModule],
  controllers: [SourcesController],
  providers: [SourceHealthService],
  exports: [SourceHealthService],
})
export class SourcesModule {}
