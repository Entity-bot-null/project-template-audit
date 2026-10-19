import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CLOCK,
  AUDIT_CONFIG,
  AUDIT_STORE,
  CLIENT_MAX_AGE_MS,
  CLIENT_MAX_SKEW_MS,
} from './audit.constants.js';
import type { AuditStore } from './audit.ports.js';
import { AuditService } from './audit.service.js';
import { actionSpec } from './catalog/catalog.js';
import {
  type AuditEventDraft,
  AuditEventDraftSchema,
  type ClientDeclaredSection,
  type ClientEventBatchResult,
  type ClientEventResult,
  ClientEventSchema,
  compileFields,
  CONTRACT_VERSION,
  LIMITS,
} from './contract/index.js';
import type { RequestUser } from './host.js';
import { scopeOf } from './request-scope.js';

/**
 * Events of the project's app and web app (docs/design/audit-hub/contract.md#clientevent),
 * sent through its own API with the user's token: only actions the catalog
 * gives to clients, with the actor, the address and the request taken from
 * the server, never from the device. What the device declared is marked as
 * such. Each eventId is queued once, whatever the retries.
 */
/**
 * The route's body: the contract's batch, with `details` as any JSON object.
 * The contract types its values with z.json(), which refers to itself, and
 * an OpenAPI schema written inline cannot; a JSON body holds only JSON
 * anyway. Each event is then checked here on its own, against the catalog
 * and the whole contract: one wrong event never sinks the batch.
 */
export const ClientEventBatchBodySchema = z.strictObject({
  events: z
    .array(
      ClientEventSchema.extend({
        details: z.record(z.string().max(128), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(LIMITS.clientBatchEvents),
  discardedAtSignOut: z.int().min(0).max(LIMITS.clientQueueEvents).optional(),
});
export type ClientEventBatchBody = z.infer<typeof ClientEventBatchBodySchema>;
type ClientEventBody = ClientEventBatchBody['events'][number];

@Injectable()
export class ClientEventsService {
  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
    private readonly audit: AuditService,
  ) {}

  async receive(
    user: RequestUser,
    req: Request,
    batch: ClientEventBatchBody,
  ): Promise<ClientEventBatchResult> {
    if (this.config === null) throw new NotFoundException('Not found');
    if (batch.discardedAtSignOut !== undefined) this.audit.countDiscarded(batch.discardedAtSignOut);
    const scope = scopeOf(req);
    const now = this.clock();
    const results: ClientEventResult[] = [];
    const drafts: AuditEventDraft[] = [];
    const seen = new Set<string>();
    for (const event of batch.events) {
      if (seen.has(event.eventId)) {
        results.push({ eventId: event.eventId, status: 'duplicate' });
        continue;
      }
      seen.add(event.eventId);
      const outcome = this.draftOf(event, user, scope, now);
      if (typeof outcome === 'string') {
        results.push({ eventId: event.eventId, status: 'rejected', reason: outcome });
      } else {
        drafts.push(outcome);
        results.push({ eventId: event.eventId, status: 'accepted' });
      }
    }
    const queued = drafts.length === 0 ? new Set<string>() : await this.store.enqueueAlone(drafts);
    return {
      results: results.map((result) =>
        result.status === 'accepted' && !queued.has(result.eventId)
          ? { eventId: result.eventId, status: 'duplicate' }
          : result,
      ),
    };
  }

  /** The queued form of a device's event, or why it is refused. */
  private draftOf(
    event: ClientEventBody,
    user: RequestUser,
    scope: ReturnType<typeof scopeOf>,
    now: number,
  ): AuditEventDraft | string {
    const spec = actionSpec(event.action);
    if (spec === undefined || spec.source === 'server') return 'action_not_allowed';
    if (spec.outcomes !== undefined && !spec.outcomes.includes(event.outcome)) {
      return 'outcome_not_allowed';
    }
    if (event.details !== undefined) {
      const details = compileFields(spec.details?.fields ?? {}).safeParse(event.details);
      if (!details.success) return 'details_invalid';
    }
    const occurred = Date.parse(event.occurredAt);
    const occurredAt =
      occurred < now - CLIENT_MAX_AGE_MS || occurred > now + CLIENT_MAX_SKEW_MS
        ? new Date(now).toISOString()
        : event.occurredAt;
    const declared: ClientDeclaredSection[] = ['occurredAt', 'client'];
    if (event.location !== undefined) declared.push('location');
    if (event.details !== undefined) declared.push('details');
    if (event.resource !== undefined) declared.push('resource');
    const draft = AuditEventDraftSchema.safeParse({
      schemaVersion: CONTRACT_VERSION,
      eventId: event.eventId,
      occurredAt,
      catalogVersion: this.audit.catalogVersion,
      category: spec.category,
      action: event.action,
      outcome: event.outcome,
      ...(event.reason === undefined ? {} : { reason: event.reason }),
      actor: { type: 'user', id: user.id, role: user.role },
      ...(event.resource === undefined ? {} : { resource: event.resource }),
      ...(scope.requestId === undefined ? {} : { request: { requestId: scope.requestId } }),
      network: {
        ...(scope.ip === undefined ? {} : { ip: scope.ip }),
        ...(scope.userAgent === undefined ? {} : { userAgent: scope.userAgent }),
      },
      client: event.client,
      ...(event.location === undefined ? {} : { location: event.location }),
      clientDeclared: declared,
      ...(event.details === undefined ? {} : { details: event.details }),
    });
    return draft.success ? draft.data : 'schema_invalid';
  }
}
