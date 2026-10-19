import { z } from 'zod';
import { CLIENT_TYPES, HUB_CATEGORIES, OUTCOMES, TimestampSchema, Uuidv7Schema } from './event.js';
import { ACTION_PATTERN, COUNTRY_PATTERN } from './patterns.js';

// The query API applications call on Audit Hub (/api/connector/*), signed
// like ingestion. Each answer covers one subject (an application's user) and
// only that application's data.

/** One line of "My account's security": what the user may see of their own activity. */
export const ActivityItemSchema = z.strictObject({
  eventId: Uuidv7Schema,
  action: z.string().regex(ACTION_PATTERN),
  description: z.string().max(500),
  outcome: z.enum(OUTCOMES),
  occurredAt: TimestampSchema,
  client: z
    .strictObject({
      type: z.enum(CLIENT_TYPES).optional(),
      os: z.string().max(32).optional(),
      deviceModel: z.string().max(64).optional(),
      appVersion: z.string().max(32).optional(),
      browser: z.string().max(64).optional(),
    })
    .optional(),
  location: z
    .strictObject({
      country: z.string().regex(COUNTRY_PATTERN).optional(),
      city: z.string().max(128).optional(),
    })
    .optional(),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const ActivityPageSchema = z.strictObject({
  items: z.array(ActivityItemSchema),
  /** Absent on the last page. */
  nextCursor: z.string().max(256).optional(),
  /** "IP Geolocation by DB-IP" when a location came from it (ADR 0011). */
  attribution: z.string().max(200).optional(),
});
export type ActivityPage = z.infer<typeof ActivityPageSchema>;

export const ActivityQuerySchema = z.strictObject({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * What an erasure deletes: the personal data of every event of the subject
 * (personal: the events stay, pseudonymous, until their retention), or the
 * events too (events: once the controller cancels them, LFPDPPP art. 24).
 */
export const ERASURE_SCOPES = ['personal', 'events'] as const;
export type ErasureScope = (typeof ERASURE_SCOPES)[number];

/** The body of an erasure request; without one, the personal scope. */
export const ErasureRequestSchema = z.strictObject({
  scope: z.enum(ERASURE_SCOPES).default('personal'),
});
export type ErasureRequest = z.infer<typeof ErasureRequestSchema>;

export const ErasureResultSchema = z.strictObject({
  personalDeleted: z.int().min(0),
  locationDeleted: z.int().min(0),
  /** Rows a legal hold kept. */
  held: z.int().min(0),
  /** Scope events: the events deleted now. */
  eventsDeleted: z.int().min(0).optional(),
  /** Scope events: the ones not sealed yet, deleted once they are (within a day). */
  eventsPending: z.int().min(0).optional(),
});
export type ErasureResult = z.infer<typeof ErasureResultSchema>;

/**
 * Right of access: one of the subject's events, with what Audit Hub still
 * keeps of it (personal data for 90 days, a device location for 30).
 */
export const SubjectExportItemSchema = z.strictObject({
  eventId: Uuidv7Schema,
  action: z.string().regex(ACTION_PATTERN),
  category: z.enum(HUB_CATEGORIES),
  outcome: z.enum(OUTCOMES),
  occurredAt: TimestampSchema,
  recordedAt: TimestampSchema,
  /** The subject acted, or the event was about them. */
  role: z.enum(['actor', 'resource']),
  details: z.unknown().optional(),
  change: z
    .strictObject({ before: z.unknown().optional(), after: z.unknown().optional() })
    .optional(),
  client: z
    .strictObject({
      type: z.enum(CLIENT_TYPES).optional(),
      os: z.string().max(32).optional(),
      deviceModel: z.string().max(64).optional(),
      appVersion: z.string().max(32).optional(),
    })
    .optional(),
  network: z
    .strictObject({
      ip: z.string().max(64).optional(),
      userAgent: z.string().max(1024).optional(),
      country: z.string().regex(COUNTRY_PATTERN).optional(),
      city: z.string().max(128).optional(),
    })
    .optional(),
  location: z
    .strictObject({ latitude: z.number(), longitude: z.number(), capturedAt: TimestampSchema })
    .optional(),
});
export type SubjectExportItem = z.infer<typeof SubjectExportItemSchema>;

export const SubjectExportPageSchema = z.strictObject({
  items: z.array(SubjectExportItemSchema),
  /** Absent on the last page. */
  nextCursor: z.string().max(256).optional(),
  attribution: z.string().max(200).optional(),
});
export type SubjectExportPage = z.infer<typeof SubjectExportPageSchema>;
