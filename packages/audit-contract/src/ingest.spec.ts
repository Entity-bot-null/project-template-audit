import { describe, expect, it } from 'vitest';
import {
  ActivityPageSchema,
  ActivityQuerySchema,
  ErasureRequestSchema,
  ErasureResultSchema,
} from './connector-api.js';
import {
  CatalogPublishSchema,
  EventBatchEnvelopeSchema,
  EventBatchResultSchema,
  EventBatchSchema,
  HeartbeatResultSchema,
  HeartbeatSchema,
  RETRYABLE_REJECTIONS,
} from './ingest.js';
import { auditEvent, catalog, EPOCH, EVENT_ID } from './testing/fixtures.js';
import { WebhookEnvelopeSchema, WebhookReplySchema, WebhookSchema } from './webhook.js';

const connector = { name: 'audit-nestjs', version: '0.1.0' };

describe('ingestion documents', () => {
  it('accepts a batch and bounds it', () => {
    const batch = { contractVersion: 1, connector, sequenceEpoch: EPOCH, events: [auditEvent()] };
    expect(EventBatchSchema.safeParse(batch).success).toBe(true);
    const tooMany = { ...batch, events: Array.from({ length: 101 }, () => auditEvent()) };
    expect(EventBatchSchema.safeParse(tooMany).success).toBe(false);
    expect(
      EventBatchEnvelopeSchema.safeParse({ ...batch, events: [{ anything: 1 }] }).success,
    ).toBe(true);
    expect(EventBatchEnvelopeSchema.safeParse({ ...batch, events: [] }).success).toBe(false);
  });

  it('describes per-event results', () => {
    const result = {
      results: [
        {
          index: 0,
          eventId: EVENT_ID,
          sourceSeq: 1,
          status: 'accepted',
          truncatedFields: ['actor.label'],
        },
        { index: 1, status: 'rejected', reason: 'catalog_version_unknown', retryable: true },
      ],
      accepted: 1,
      duplicates: 0,
      rejected: 1,
    };
    expect(EventBatchResultSchema.safeParse(result).success).toBe(true);
    expect(RETRYABLE_REJECTIONS).toEqual(['catalog_version_unknown']);
  });

  it('accepts a catalog publication and a heartbeat', () => {
    expect(CatalogPublishSchema.safeParse({ contractVersion: 1, catalog: catalog() }).success).toBe(
      true,
    );
    const heartbeat = {
      contractVersion: 1,
      connector,
      instanceId: EPOCH,
      appVersion: '1.4.2',
      catalogVersion: '0123456789abcdef',
      sequenceEpoch: EPOCH,
      lastAssignedSeq: 10,
      queue: { size: 0, oldestAgeSeconds: 0, retrying: 0, discardedAtSignOut: 0 },
      responseActions: [],
    };
    expect(HeartbeatSchema.safeParse(heartbeat).success).toBe(true);
    expect(
      HeartbeatResultSchema.safeParse({
        serverTime: '2026-10-14T12:00:00.000Z',
        contractVersions: [1],
        lastContiguousSeq: 10,
        connectorNotice: null,
      }).success,
    ).toBe(true);
  });
});

describe('webhooks and the query API', () => {
  it('reads every webhook type and leaves unknown ones to the envelope', () => {
    const base = { id: EPOCH, createdAt: '2026-10-14T12:00:00.000Z', contractVersion: 1 };
    const suspicious = {
      ...base,
      type: 'security.sign_in_suspicious',
      data: {
        subject: 'user-1',
        eventId: EVENT_ID,
        occurredAt: '2026-10-14T12:00:00.000Z',
        signals: ['new_device'],
        context: { country: 'MX', clientType: 'android' },
      },
    };
    expect(WebhookSchema.safeParse(suspicious).success).toBe(true);
    expect(WebhookSchema.safeParse({ ...base, type: 'ping', data: {} }).success).toBe(true);
    const action = {
      ...base,
      type: 'response_action.requested',
      data: {
        actionId: EPOCH,
        action: 'revoke_sessions',
        subject: 'user-1',
        reason: 'Account taken over',
        requestedAt: base.createdAt,
        expiresAt: base.createdAt,
      },
    };
    expect(WebhookSchema.safeParse(action).success).toBe(true);
    const unknown = { ...base, type: 'something.new', data: { x: 1 } };
    expect(WebhookSchema.safeParse(unknown).success).toBe(false);
    expect(WebhookEnvelopeSchema.safeParse(unknown).success).toBe(true);
    expect(WebhookReplySchema.parse({ status: 'unsupported' })).toEqual({ status: 'unsupported' });
  });

  it('describes activity pages, their query and erasure results', () => {
    const page = {
      items: [
        {
          eventId: EVENT_ID,
          action: 'auth.session.signed_in',
          description: 'Signed in',
          outcome: 'success',
          occurredAt: '2026-10-14T12:00:00.000Z',
          client: { type: 'web', browser: 'Firefox' },
          location: { country: 'MX', city: 'Mérida' },
        },
      ],
      attribution: 'IP Geolocation by DB-IP',
    };
    expect(ActivityPageSchema.safeParse(page).success).toBe(true);
    expect(ActivityQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(
      ErasureResultSchema.safeParse({ personalDeleted: 3, locationDeleted: 0, held: 1 }).success,
    ).toBe(true);
    expect(
      ErasureResultSchema.safeParse({
        personalDeleted: 3,
        locationDeleted: 0,
        held: 0,
        eventsDeleted: 5,
        eventsPending: 1,
      }).success,
    ).toBe(true);
  });

  it('takes an erasure without a body as the personal scope, and only the two scopes', () => {
    expect(ErasureRequestSchema.parse({})).toEqual({ scope: 'personal' });
    expect(ErasureRequestSchema.parse({ scope: 'events' })).toEqual({ scope: 'events' });
    expect(ErasureRequestSchema.safeParse({ scope: 'all' }).success).toBe(false);
    expect(ErasureRequestSchema.safeParse({ scope: 'events', subject: 'x' }).success).toBe(false);
  });
});
