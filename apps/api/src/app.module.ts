import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from './access/access.module.js';
import { AccountModule } from './account/account.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { FetchMetadataGuard } from './common/guards/fetch-metadata.guard.js';
import { RateLimitGuard, rateLimitOptions } from './common/guards/rate-limit.guard.js';
import { env } from './env/env.js';
import { ConnectedAppsModule } from './connected-apps/connected-apps.module.js';
import { ConnectorModule } from './connector/connector.module.js';
import { EnrichmentModule } from './enrichment/enrichment.module.js';
import { ExplorerModule } from './explorer/explorer.module.js';
import { HealthModule } from './health/health.module.js';
import { HubAuditModule } from './hub-audit/hub-audit.module.js';
import { CacheModule } from './infrastructure/cache/cache.module.js';
import { CoordinationModule } from './infrastructure/coordination/coordination.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module.js';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from './infrastructure/rate-limit/rate-limit.store.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { IngestModule } from './ingest/ingest.module.js';
import { IntegrityModule } from './integrity/integrity.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { GracefulShutdown, ShutdownStateModule } from './lifecycle/shutdown.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ResponseActionsModule } from './response-actions/response-actions.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { RulesModule } from './rules/rules.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { UsersModule } from './users/users.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    ShutdownStateModule,
    // Optional infrastructure: without REDIS_URL every adapter below uses its
    // in-process implementation (docs/architecture.md#optional-infrastructure).
    RedisModule,
    CacheModule,
    CoordinationModule,
    // The global limit and the routes' own (common/guards/rate-limit.guard.ts),
    // counted in the store RATE_LIMIT_STORE names: memory for one instance,
    // Redis when several share the limits (docs/security.md#rate-limiting).
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RATE_LIMIT_STORE],
      useFactory: (storage: RateLimitStore) =>
        rateLimitOptions(storage, {
          limit: env.RATE_LIMIT_MAX,
          windowSec: env.RATE_LIMIT_WINDOW_SEC,
        }),
    }),
    PrismaModule,
    // Audit Hub's secrets at rest (docs/adr/0006).
    CryptoModule,
    // Email (docs/architecture.md#email); off without MAIL_SMTP_URL. After
    // PrismaModule on purpose: global modules are destroyed in the reverse
    // order of these imports, so the mail worker stops (finishing the message
    // it is sending) before the database pool closes.
    MailModule,
    // Audit Hub's own audit trail (global): its people's sign-ins and actions.
    HubAuditModule,
    AuthModule,
    AccountModule,
    InvitationsModule,
    UsersModule,
    // Audit Hub: connected applications and the signed ingestion API, with
    // what it adds to events (docs/adr/0011).
    EnrichmentModule,
    ConnectedAppsModule,
    IngestModule,
    // Append-only storage, retention and integrity (docs/adr/0007, docs/adr/0008).
    IntegrityModule,
    RetentionModule,
    // Rules, alerts, webhooks and response actions (docs/adr/0013).
    AccessModule,
    WebhooksModule,
    AlertsModule,
    ResponseActionsModule,
    RulesModule,
    // The audit log as the admin pages read it, and as applications ask
    // about their users (docs/design/audit-hub).
    ExplorerModule,
    ConnectorModule,
    HealthModule,
    TelemetryModule,
  ],
  providers: [
    // In the root module so its destroy hook runs first: requests in flight
    // finish before the database and Redis connections close.
    GracefulShutdown,
    // Global guards run in this order, before any controller guard. Requests
    // another site made a browser send are refused first, so they cannot use up
    // a victim's rate limit; the limiter then counts everything else,
    // unauthenticated and forbidden requests included.
    { provide: APP_GUARD, useClass: FetchMetadataGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
