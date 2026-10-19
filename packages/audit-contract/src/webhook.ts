import { z } from 'zod';
import { RESPONSE_ACTIONS } from './catalog.js';
import { CLIENT_TYPES, IdSchema, SEVERITIES, TimestampSchema, Uuidv7Schema } from './event.js';
import { COUNTRY_PATTERN } from './patterns.js';

// Webhooks: Audit Hub to an application (POST /api/audit/webhooks in projects
// created from the templates), signed like ingestion requests (signing.ts).
// An application answers 200 with the status below to every delivery it
// verified, also to types it does not know (unsupported).

export const WEBHOOK_TYPES = [
  'ping',
  'alert.created',
  'security.sign_in_suspicious',
  'response_action.requested',
] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

export const SUSPICIOUS_SIGNALS = [
  'new_device',
  'new_country',
  'impossible_travel',
  'hosting_ip',
  'location_mismatch',
] as const;
export type SuspiciousSignal = (typeof SUSPICIOUS_SIGNALS)[number];

export const PingDataSchema = z.strictObject({});

export const AlertCreatedDataSchema = z.strictObject({
  alertId: z.uuid(),
  rule: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
  severity: z.enum(SEVERITIES),
  subject: IdSchema.optional(),
  /** Ids, counts and countries; never an email or an IP. */
  summary: z.string().max(500),
  firstEventId: Uuidv7Schema,
});

export const SuspiciousSignInDataSchema = z.strictObject({
  subject: IdSchema,
  /** The application's own event (its eventId). */
  eventId: Uuidv7Schema,
  occurredAt: TimestampSchema,
  signals: z.array(z.enum(SUSPICIOUS_SIGNALS)).min(1),
  context: z.strictObject({
    country: z.string().regex(COUNTRY_PATTERN).optional(),
    city: z.string().max(128).optional(),
    clientType: z.enum(CLIENT_TYPES).optional(),
    deviceModel: z.string().max(64).optional(),
  }),
});

export const ResponseActionRequestedDataSchema = z.strictObject({
  actionId: z.uuid(),
  action: z.enum(RESPONSE_ACTIONS),
  subject: IdSchema,
  reason: z.string().min(10).max(500),
  requestedAt: TimestampSchema,
  expiresAt: TimestampSchema,
});

const envelope = <T extends WebhookType, D extends z.ZodType>(type: T, data: D) =>
  z.strictObject({
    id: z.uuid(),
    type: z.literal(type),
    createdAt: TimestampSchema,
    contractVersion: z.int().min(1),
    data,
  });

export const WebhookSchema = z.discriminatedUnion('type', [
  envelope('ping', PingDataSchema),
  envelope('alert.created', AlertCreatedDataSchema),
  envelope('security.sign_in_suspicious', SuspiciousSignInDataSchema),
  envelope('response_action.requested', ResponseActionRequestedDataSchema),
]);
export type Webhook = z.infer<typeof WebhookSchema>;

/** What an application reads first: any type, so unknown ones answer unsupported. */
export const WebhookEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().max(64),
  createdAt: TimestampSchema,
  contractVersion: z.int().min(1),
  data: z.unknown(),
});

export const WebhookReplySchema = z.strictObject({
  status: z.enum(['accepted', 'refused', 'unsupported']),
});
export type WebhookReply = z.infer<typeof WebhookReplySchema>;
