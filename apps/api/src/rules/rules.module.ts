import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { derivedKey } from '../common/crypto/secret-box.js';
import { env } from '../env/env.js';
import { IntegrityModule } from '../integrity/integrity.module.js';
import { ResponseActionsModule } from '../response-actions/response-actions.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PeriodicRulesService } from './periodic-rules.service.js';
import { RealtimeRulesService } from './realtime-rules.service.js';
import { RULES_KEY } from './rules.constants.js';

// Detection rules (docs/security.md#detection-rules): on every event, and
// over windows of events. They only raise alerts and tell the application;
// every action on a person is a human's request (docs/adr/0013).
@Module({
  imports: [AlertsModule, IntegrityModule, ResponseActionsModule, WebhooksModule],
  providers: [
    {
      provide: RULES_KEY,
      useFactory: () =>
        derivedKey(
          { secret: env.AUDIT_SECRETS_KEY, previous: undefined, fallback: env.JWT_ACCESS_SECRET },
          'rules-pseudonyms',
        ),
    },
    PeriodicRulesService,
    RealtimeRulesService,
  ],
  exports: [PeriodicRulesService, RealtimeRulesService],
})
export class RulesModule {}
