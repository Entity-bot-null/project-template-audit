import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ExplorerModule } from '../explorer/explorer.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { AlertEscalationService } from './alert-escalation.service.js';
import { AlertMutesController } from './alert-mutes.controller.js';
import { AlertMutesService } from './alert-mutes.service.js';
import { AlertStreamService } from './alert-stream.service.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { DetectionController } from './detection.controller.js';
import { EscalationPoliciesService } from './escalation-policies.service.js';
import { RuleSettingsService } from './rule-settings.service.js';

// Alerts: raised by the rules (apps/api/src/rules), notified, escalated,
// silenced, streamed live to the panel and worked on by people; the rules'
// settings and the escalation policies.
@Module({
  imports: [AuthModule, AccessModule, ExplorerModule, WebhooksModule],
  controllers: [AlertsController, AlertMutesController, DetectionController],
  providers: [
    AlertsService,
    AlertMutesService,
    AlertStreamService,
    AlertEscalationService,
    EscalationPoliciesService,
    RuleSettingsService,
  ],
  exports: [AlertsService, AlertMutesService, RuleSettingsService],
})
export class AlertsModule {}
