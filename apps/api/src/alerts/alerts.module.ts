import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ExplorerModule } from '../explorer/explorer.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

@Module({
  imports: [AuthModule, AccessModule, ExplorerModule, WebhooksModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
