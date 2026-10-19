import { type DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityService } from './activity.service.js';
import type { AuditConfig } from './audit-env.js';
import { AUDIT_CLOCK, AUDIT_CONFIG } from './audit.constants.js';
import {
  AccountSecurityController,
  ClientEventsController,
  WebhooksController,
} from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { auditWiring } from './audit.wiring.js';
import { ClientEventsService } from './client-events.service.js';
import { AuditErasureService } from './erasure.service.js';
import { ForwarderService } from './forwarder.service.js';
import { HubClient } from './hub-client.js';
import { AuditScopeInterceptor } from './request-scope.js';
import { PushService } from './push.service.js';
import { SecurityPromptsService } from './security-prompts.service.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * The Audit Hub connector, in the project's AppModule:
 *
 *   imports: [..., AuditModule.forRoot(auditConfigFromEnv(env))]
 *
 * With `null` (no AUDIT_HUB_* variables) it is off: AuditService validates
 * and drops, no worker starts, its routes answer 404. Global: every module
 * can inject AuditService, and AuditErasureService (a user's right to erasure).
 */
@Module({})
export class AuditModule {
  static forRoot(config: AuditConfig | null): DynamicModule {
    return {
      module: AuditModule,
      global: true,
      imports: auditWiring.imports,
      controllers: [ClientEventsController, WebhooksController, AccountSecurityController],
      providers: [
        { provide: AUDIT_CONFIG, useValue: config },
        { provide: AUDIT_CLOCK, useValue: () => Date.now() },
        ...auditWiring.providers,
        AuditService,
        HubClient,
        ForwarderService,
        ClientEventsService,
        ActivityService,
        AuditErasureService,
        WebhooksService,
        SecurityPromptsService,
        PushService,
        { provide: APP_INTERCEPTOR, useClass: AuditScopeInterceptor },
      ],
      exports: [AuditService, AuditErasureService],
    };
  }
}
