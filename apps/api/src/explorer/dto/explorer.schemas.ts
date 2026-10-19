import { CATEGORIES, CLIENT_TYPES, ID_PATTERN, OUTCOMES, SEVERITIES } from 'audit-contract';
import { z } from 'zod';

// The admin pages' view of the audit log (docs/design/audit-hub): filters in
// the URL, cursor pagination, one query per answer.

const HUB_CATEGORY_VALUES = [...CATEGORIES, 'audit_access'] as const;

/** Filters the explorer, the exports and the subject's activity share. */
export const EventFiltersSchema = z.object({
  appId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  category: z.enum(HUB_CATEGORY_VALUES).optional(),
  action: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{0,127}$/)
    .optional(),
  outcome: z.enum(OUTCOMES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  /** Events with a risk score of this or more (0–100: 60 is a high severity's weight). */
  minRisk: z.coerce.number().int().min(0).max(100).optional(),
  actorId: z.string().regex(ID_PATTERN).optional(),
  /** Matched by its pseudonym (the application's key): needs appId. Never stored. */
  email: z.string().trim().max(254).pipe(z.email()).optional(),
  resourceType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  resourceId: z.string().regex(ID_PATTERN).optional(),
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  clientType: z.enum(CLIENT_TYPES).optional(),
  requestId: z.string().max(128).optional(),
});
export type EventFilters = z.infer<typeof EventFiltersSchema>;

export const PAGE_LIMIT = 100;

export const EventQuerySchema = EventFiltersSchema.extend({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).default(50),
});
export type EventQuery = z.infer<typeof EventQuerySchema>;

export const EventSummarySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  appId: z.uuid(),
  appSlug: z.string(),
  recordedAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
  category: z.string(),
  action: z.string(),
  /** The action in words: its catalog's description (Audit Hub's own for its events); null without one. */
  description: z.string().nullable(),
  outcome: z.string(),
  severity: z.string(),
  riskScore: z.int(),
  actor: z.object({
    type: z.string(),
    id: z.string().nullable(),
    role: z.string().nullable(),
    /**
     * Who it is, in words: the label the application sent (personal data,
     * kept 90 days: null once retention or erasure removed it), or the name
     * of Audit Hub's own account for its events. Never an email address:
     * Audit Hub keeps only their pseudonyms.
     */
    label: z.string().nullable(),
  }),
  resource: z.object({ type: z.string(), id: z.string() }).nullable(),
  requestId: z.string().nullable(),
  httpStatus: z.int().nullable(),
  clientType: z.string().nullable(),
  country: z.string().nullable(),
  ipScope: z.string().nullable(),
});
export type EventSummary = z.infer<typeof EventSummarySchema>;

export const EventPageSchema = z.object({
  items: z.array(EventSummarySchema),
  /** Pass it back as `cursor` for the next page; null on the last one. */
  nextCursor: z.string().nullable(),
  /**
   * A search by a subject blocked after an erasure, in one of the
   * applications searched: what occurred there up to their last erasure is
   * left out (explorer/blocked.ts).
   */
  blocked: z.literal(true).optional(),
});
export type EventPage = z.infer<typeof EventPageSchema>;

const jsonValue = z.unknown();

export const EventDetailSchema = EventSummarySchema.extend({
  /** It occurred before its actor's (or its user's) last erasure: blocked since the first one. */
  blockedSince: z.iso.datetime().nullable(),
  sequence: z.object({ epoch: z.string(), seq: z.string() }).nullable(),
  catalog: z.object({ description: z.string().nullable(), tags: z.array(z.string()) }),
  reason: z.string().nullable(),
  actorDetail: z.object({
    emailPseudonym: z.string().nullable(),
    impersonatorId: z.string().nullable(),
    sessionRef: z.string().nullable(),
  }),
  parentResource: z.object({ type: z.string(), id: z.string() }).nullable(),
  change: z.object({
    before: jsonValue,
    after: jsonValue,
    fields: z.array(z.string()),
  }),
  request: z.object({
    method: z.string().nullable(),
    route: z.string().nullable(),
    traceId: z.string().nullable(),
    durationMs: z.int().nullable(),
  }),
  client: z.object({
    appVersion: z.string().nullable(),
    appBuild: z.string().nullable(),
    os: z.string().nullable(),
    osVersion: z.string().nullable(),
    deviceModel: z.string().nullable(),
    locale: z.string().nullable(),
    timeZone: z.string().nullable(),
    networkType: z.string().nullable(),
    route: z.string().nullable(),
    sdk: z.string().nullable(),
    declared: z.array(z.string()),
  }),
  network: z.object({
    asn: z.int().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceClass: z.string().nullable(),
  }),
  details: jsonValue,
  /** Personal data, kept 90 days (event_personal): null once retention or erasure removed it. */
  personal: z
    .object({
      ip: z.string().nullable(),
      userAgent: z.string().nullable(),
      /**
       * The user agent read in full when the detail is opened, with the
       * request's client hints first when the browser sent them: the browser
       * (its real brand) and the system with their versions (a frozen one said
       * as such: "Windows 10 or 11"), the device's maker and model.
       */
      agent: z
        .object({
          browser: z.string().nullable(),
          os: z.string().nullable(),
          device: z.string().nullable(),
        })
        .nullable(),
      deviceId: z.string().nullable(),
      actorLabel: z.string().nullable(),
      /** The actor's phone, masked at the origin (•••• 1234); null when the application sent none. */
      actorPhone: z.string().nullable(),
      resourceLabel: z.string().nullable(),
      subdivision: z.string().nullable(),
      city: z.string().nullable(),
      /** The city's coordinates from the IP address database: approximate, never the device's. */
      approximateLocation: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          accuracyKm: z.int().nullable(),
        })
        .nullable(),
      change: jsonValue,
    })
    .nullable(),
  /** The device's location, kept 30 days. */
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyM: z.int(),
      capturedAt: z.iso.datetime(),
    })
    .nullable(),
  quality: z.object({
    truncatedFields: z.array(z.string()),
    droppedFields: z.array(z.string()),
    flags: z.array(z.string()),
  }),
  integrity: z.object({
    /** In a seal: covered by the hash chain. */
    sealed: z.boolean(),
    sealNo: z.string().nullable(),
    /** The last verification that passed after it was sealed. */
    verifiedAt: z.iso.datetime().nullable(),
    /** SHA-256 of the event's canonical content (hex): the leaf its seal covers. */
    contentHash: z.string(),
    /** The seal: its hash in the chain (hex), its signature (base64) and the signing key's fingerprint. */
    seal: z.object({ hash: z.string(), signature: z.string(), keyId: z.string() }).nullable(),
  }),
  /** Events of the same request (the server's and the app's), oldest first. */
  related: z.array(EventSummarySchema),
});
export type EventDetail = z.infer<typeof EventDetailSchema>;

export const SubjectQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).default(50),
  /** Also the same person in other applications with correlation on (by email pseudonym). */
  acrossApps: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type SubjectQuery = z.infer<typeof SubjectQuerySchema>;

export const SubjectActivitySchema = z.object({
  subject: z.string(),
  appId: z.uuid(),
  /** Blocked after an erasure, since the first one; null when not blocked. */
  blockedSince: z.iso.datetime().nullable(),
  /** The last erasure: what occurred up to it is left out of the view and its summary. */
  blockedThrough: z.iso.datetime().nullable(),
  summary: z.object({
    firstSeenAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    lastSignInAt: z.iso.datetime().nullable(),
    devices: z.int(),
    countries: z.array(z.string()),
    openAlerts: z.int(),
    /** Other applications where the same person appears (correlation on). */
    otherApps: z.array(z.object({ appId: z.uuid(), slug: z.string() })),
  }),
  events: EventPageSchema,
});

export const HistoryQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).default(50),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const SecurityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const SecurityOverviewSchema = z.object({
  appId: z.uuid(),
  days: z.int(),
  /** Without a geolocation database, countries are unknown: the page says so. */
  geolocation: z.boolean(),
  failedSignIns: z.array(z.object({ day: z.string(), count: z.int() })),
  topIps: z.array(z.object({ ip: z.string(), count: z.int(), accounts: z.int() })),
  topCountries: z.array(z.object({ country: z.string(), count: z.int() })),
  /** Failed sign-ins by day of the week (0 = Sunday) and hour, UTC. */
  heatmap: z.array(z.object({ dow: z.int(), hour: z.int(), count: z.int() })),
  anomalies: z.array(z.object({ rule: z.string(), severity: z.string(), open: z.int() })),
});
export type SecurityOverview = z.infer<typeof SecurityOverviewSchema>;

/** From this risk score up an event counts as high risk: a high severity's weight (ingest/risk.ts). */
export const HIGH_RISK_SCORE = 60;

export const OverviewSchema = z.object({
  /** The start of the 24 hours the figures count (a search from it finds their events). */
  since: z.iso.datetime(),
  /**
   * The log's integrity for the caller's applications: the latest
   * verification that covered them (all applications, or one of theirs).
   * Failed only when what failed concerns them; null before any.
   */
  integrity: z
    .object({
      outcome: z.enum(['passed', 'failed', 'error']),
      finishedAt: z.iso.datetime(),
    })
    .nullable(),
  apps: z.array(
    z.object({
      appId: z.uuid(),
      slug: z.string(),
      name: z.string(),
      status: z.string(),
      events24h: z.int(),
      /** Events of the last 24 hours with a risk score of HIGH_RISK_SCORE or more. */
      highRisk24h: z.int(),
      rejected24h: z.int(),
      openAlerts: z.record(z.string(), z.int()),
      lastHeartbeatAt: z.iso.datetime().nullable(),
      queueSize: z.int(),
      openGaps: z.int(),
      /** Events per hour over the last 24 hours, oldest first. */
      trend: z.array(z.int()),
    }),
  ),
});
export type Overview = z.infer<typeof OverviewSchema>;
