import { z } from 'zod';
import { CatalogDocumentSchema } from './catalog.js';
import { AuditEventSchema, Uuidv7Schema } from './event.js';
import {
  CATALOG_VERSION_PATTERN,
  SDK_NAME_PATTERN,
  SEMVER_PATTERN,
  VERSION_TOKEN_PATTERN,
} from './patterns.js';
import { LIMITS } from './version.js';

// The ingestion API of Audit Hub (/api/ingest/*), application to Audit Hub,
// every request signed (signing.ts).

export const ConnectorIdSchema = z.strictObject({
  name: z.string().regex(SDK_NAME_PATTERN),
  version: z.string().regex(SEMVER_PATTERN),
});
export type ConnectorId = z.infer<typeof ConnectorIdSchema>;

const contractVersion = z.int().min(1).max(1000);

/** POST /api/ingest/events, as a connector sends it. */
export const EventBatchSchema = z.strictObject({
  contractVersion,
  connector: ConnectorIdSchema,
  /** Changes when the connector's sequence restarts (a restore, a reset). */
  sequenceEpoch: z.uuid(),
  events: z.array(AuditEventSchema).min(1).max(LIMITS.batchEvents),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

/**
 * The same envelope as Audit Hub reads it: events are judged one by one
 * (normalize.ts), so one bad event never sinks the batch.
 */
export const EventBatchEnvelopeSchema = z.strictObject({
  contractVersion,
  connector: ConnectorIdSchema,
  sequenceEpoch: z.uuid(),
  events: z.array(z.unknown()).min(1).max(LIMITS.batchEvents),
});

export const REJECTION_REASONS = [
  'schema_invalid',
  'too_large',
  'action_unknown',
  'catalog_version_unknown',
  'details_invalid',
  'category_mismatch',
  'category_reserved',
  'outcome_not_allowed',
  /** A device-declared event for an action only the server may record. */
  'source_not_allowed',
  'occurred_at_too_old',
  'sequence_conflict',
  'contract_version_unsupported',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Rejections the connector keeps in its queue and sends again later. */
export const RETRYABLE_REJECTIONS: readonly RejectionReason[] = ['catalog_version_unknown'];

export const EVENT_STATUSES = ['accepted', 'duplicate', 'rejected'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EventResultSchema = z.strictObject({
  index: z.int().min(0),
  eventId: z.string().optional(),
  sourceSeq: z.int().min(1).optional(),
  status: z.enum(EVENT_STATUSES),
  reason: z.enum(REJECTION_REASONS).optional(),
  retryable: z.boolean().optional(),
  /** Paths whose string was cut to its maximum length. */
  truncatedFields: z.array(z.string()).optional(),
  /** Optional fields that were invalid and left out. */
  droppedFields: z.array(z.string()).optional(),
});
export type EventResult = z.infer<typeof EventResultSchema>;

export const EventBatchResultSchema = z.strictObject({
  results: z.array(EventResultSchema),
  accepted: z.int().min(0),
  duplicates: z.int().min(0),
  rejected: z.int().min(0),
});
export type EventBatchResult = z.infer<typeof EventBatchResultSchema>;

/** PUT /api/ingest/catalog */
export const CatalogPublishSchema = z.strictObject({
  contractVersion,
  catalog: CatalogDocumentSchema,
});
export type CatalogPublish = z.infer<typeof CatalogPublishSchema>;

export const CatalogPublishResultSchema = z.strictObject({
  version: z.string().regex(CATALOG_VERSION_PATTERN),
  status: z.enum(['created', 'unchanged']),
  actions: z.int().min(0),
});
export type CatalogPublishResult = z.infer<typeof CatalogPublishResultSchema>;

/** POST /api/ingest/heartbeat, every minute from every connector process. */
export const HeartbeatSchema = z.strictObject({
  contractVersion,
  connector: ConnectorIdSchema,
  instanceId: z.uuid(),
  appVersion: z.string().regex(VERSION_TOKEN_PATTERN),
  catalogVersion: z.string().regex(CATALOG_VERSION_PATTERN),
  sequenceEpoch: z.uuid(),
  lastAssignedSeq: z.int().min(0),
  queue: z.strictObject({
    size: z.int().min(0),
    oldestAgeSeconds: z.int().min(0),
    retrying: z.int().min(0),
    discardedAtSignOut: z.int().min(0),
  }),
  responseActions: z.array(z.string().max(64)).max(8),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const HeartbeatResultSchema = z.strictObject({
  serverTime: z.iso.datetime(),
  contractVersions: z.array(z.int()),
  lastContiguousSeq: z.int().min(0),
  /** A deprecation warning for this connector's contract version, if any. */
  connectorNotice: z.string().max(500).nullable(),
});
export type HeartbeatResult = z.infer<typeof HeartbeatResultSchema>;

/** Event ids shared by both directions (a webhook names the event behind it). */
export const EventIdSchema = Uuidv7Schema;
