import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectedAppsModule } from '../connected-apps/connected-apps.module.js';
import { env } from '../env/env.js';
import { guardedFetch } from './guarded-fetch.js';
import { WebhookOutboxService } from './webhook-outbox.service.js';
import { WEBHOOK_FETCH, WebhookWorker } from './webhook-worker.service.js';
import { WebhookStore } from './webhook.store.js';
import { WebhooksController } from './webhooks.controller.js';

// The webhook outbox (docs/adr/0013): applications' webhooks and the optional
// Slack and Teams notifications.
@Module({
  imports: [AuthModule, ConnectedAppsModule],
  controllers: [WebhooksController],
  providers: [
    {
      provide: WEBHOOK_FETCH,
      useFactory: () => guardedFetch({ allowPrivate: env.AUDIT_WEBHOOKS_ALLOW_PRIVATE_NETWORKS }),
    },
    WebhookOutboxService,
    WebhookStore,
    WebhookWorker,
  ],
  exports: [WebhookOutboxService, WebhookWorker],
})
export class WebhooksModule {}
