import { z } from 'zod';
import { pageOf } from '../../common/pagination.js';
import { EventSummarySchema } from '../../explorer/dto/explorer.schemas.js';

export const ALERT_STATUSES = ['open', 'in_review', 'resolved', 'false_positive'] as const;
export const SEVERITY_VALUES = ['info', 'low', 'medium', 'high', 'critical'] as const;

/** A comma-separated query value (status=open,in_review) or a repeated one. */
const listOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
    z.array(z.enum(values)).min(1).max(values.length),
  );

const RULE_ID = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const ALERT_SORTS = ['last_seen', 'first_seen', 'severity', 'status'] as const;

export const AlertListQuerySchema = z.object({
  appId: z.uuid().optional(),
  status: listOf(ALERT_STATUSES).optional(),
  severity: listOf(SEVERITY_VALUES).optional(),
  rule: RULE_ID.optional(),
  assigneeId: z.uuid().optional(),
  /**
   * An alert's id, its rule (or the start of it), words of its title, or the
   * id of the user it is about.
   */
  q: z.string().trim().min(1).max(100).optional(),
  /** Last seen from, to (inclusive). */
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  /** true: only alerts a silence covers now; false: only the others. */
  muted: z.enum(['true', 'false']).optional(),
  sort: z.enum(ALERT_SORTS).default('last_seen'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

export const AlertSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  appSlug: z.string(),
  rule: z.string(),
  severity: z.enum(SEVERITY_VALUES),
  status: z.enum(ALERT_STATUSES),
  /** The application's user it is about, when one person. */
  subject: z.string().nullable(),
  /**
   * That person in words, looked up when read: the label their application
   * sent with the events behind it (personal data, kept 90 days: null once
   * retention or erasure removed it), or the name of Audit Hub's own account.
   */
  subjectLabel: z.string().nullable(),
  /** Ids and counts only. */
  title: z.string(),
  occurrences: z.int(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  assigneeId: z.uuid().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedById: z.uuid().nullable(),
  /** Who first took it on (Acknowledge, or In review): its escalation stopped there. */
  acknowledgedAt: z.iso.datetime().nullable(),
  acknowledgedById: z.uuid().nullable(),
  /** How many times it was escalated while nobody acknowledged it, the last one when. */
  escalations: z.int(),
  lastEscalatedAt: z.iso.datetime().nullable(),
  /** When Audit Hub opened it (firstSeenAt is when its first detection happened). */
  createdAt: z.iso.datetime(),
  /** Until when a silence covers it (nobody is notified); null when none does. */
  mutedUntil: z.iso.datetime().nullable(),
  /** The last change of it, any change: the live stream's order. */
  updatedAt: z.iso.datetime(),
  /** Send it back with a change: 409 when someone changed the alert since. */
  version: z.int(),
});
export type AlertResponse = z.infer<typeof AlertSchema>;

export const AlertPageSchema = pageOf(AlertSchema);

/** A value among the events behind an alert, and how many of them have it. */
const TallySchema = z.object({ value: z.string(), count: z.int() });

export const AlertDetailSchema = AlertSchema.extend({
  /** Ids, counts, countries and signals: never an email or an IP. */
  summary: z.record(z.string(), z.unknown()),
  /** Why it fired, in words: what its rule looks for and what it saw (alerts/alert-explanation.ts). */
  explanation: z.object({
    /** As the rule is configured now; null for a rule this version does not know. */
    looksFor: z.string().nullable(),
    /** At its latest occurrence, one sentence each. */
    saw: z.array(z.string()),
  }),
  /**
   * What the events behind it have in common, counted when read: how they
   * ended and why (their reasons: the errors), what was done, how many
   * accounts, from which countries and devices. Each list most frequent
   * first, at most 10.
   */
  evidence: z.object({
    events: z.int(),
    from: z.iso.datetime().nullable(),
    to: z.iso.datetime().nullable(),
    outcomes: z.array(TallySchema),
    reasons: z.array(TallySchema),
    actions: z.array(TallySchema),
    accounts: z.int(),
    countries: z.array(TallySchema),
    devices: z.array(TallySchema),
  }),
  /** The names of Audit Hub's accounts that work on it. */
  assigneeLabel: z.string().nullable(),
  resolvedByLabel: z.string().nullable(),
  acknowledgedByLabel: z.string().nullable(),
  activities: z.array(
    z.object({
      id: z.uuid(),
      /** created, notified, status_changed, assigned, note, acknowledged, escalated (alert_activities_kind_check). */
      kind: z.string(),
      userId: z.uuid().nullable(),
      /** Who did it, by the name of their account. */
      userLabel: z.string().nullable(),
      fromStatus: z.string().nullable(),
      toStatus: z.string().nullable(),
      note: z.string().nullable(),
      /** An assignment's assignee, by name (its note has the id, or "unassigned"). */
      assigneeLabel: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** The events behind it (the first 100), oldest first, as the explorer lists them. */
  events: z.array(EventSummarySchema),
});
export type AlertDetailResponse = z.infer<typeof AlertDetailSchema>;

export const UpdateAlertSchema = z
  .object({
    status: z.enum(ALERT_STATUSES).optional(),
    /** null unassigns. */
    assigneeId: z.uuid().nullable().optional(),
    /** Why: required to resolve it or close it as a false positive; kept in its history. */
    reason: z.string().trim().min(10).max(500).optional(),
    version: z.int().min(0),
  })
  .refine(
    (value) => value.status !== undefined || value.assigneeId !== undefined,
    'nothing to change',
  )
  .refine(
    (value) =>
      (value.status !== 'resolved' && value.status !== 'false_positive') ||
      value.reason !== undefined,
    { message: 'Say why, in 10 characters or more', path: ['reason'] },
  );
export type UpdateAlertDto = z.infer<typeof UpdateAlertSchema>;

/** Taking it on: In review, the caller its assignee when nobody is. */
export const AcknowledgeAlertSchema = z.object({ version: z.int().min(0) });

export const AlertNoteSchema = z.object({
  /** Free text for the people working on it: never paste personal data from elsewhere. */
  note: z.string().trim().min(1).max(2000),
});

const BY_SEVERITY = z.object(
  Object.fromEntries(SEVERITY_VALUES.map((severity) => [severity, z.int()])) as Record<
    (typeof SEVERITY_VALUES)[number],
    z.ZodInt
  >,
);

/** The unresolved alerts of the applications the caller sees, counted now. */
export const AlertSummarySchema = z.object({
  /** Open: nobody acknowledged them yet. */
  open: BY_SEVERITY,
  inReview: BY_SEVERITY,
  /** Unresolved alerts a silence covers now. */
  muted: z.int(),
  /** The oldest alert nobody acknowledged: how long it has waited. */
  oldestOpenAt: z.iso.datetime().nullable(),
});
export type AlertSummaryResponse = z.infer<typeof AlertSummarySchema>;

export const AlertSummaryQuerySchema = z.object({ appId: z.uuid().optional() });

export const AlertMuteSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  appSlug: z.string(),
  /** null: every rule of the application. */
  rule: z.string().nullable(),
  reason: z.string(),
  until: z.iso.datetime(),
  createdById: z.uuid(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  endedById: z.uuid().nullable(),
  /** In force now. */
  active: z.boolean(),
});
export type AlertMuteResponse = z.infer<typeof AlertMuteSchema>;

export const AlertMuteListSchema = z.object({ items: z.array(AlertMuteSchema) });

export const CreateAlertMuteSchema = z.object({
  appId: z.uuid(),
  /** null: every rule of the application. */
  rule: RULE_ID.nullable(),
  /** From 5 minutes to a week. */
  minutes: z
    .int()
    .min(5)
    .max(7 * 24 * 60),
  /** Why, for the people who will see it silenced. */
  reason: z.string().trim().min(10).max(500),
});
export type CreateAlertMuteDto = z.infer<typeof CreateAlertMuteSchema>;

export const AlertMuteQuerySchema = z.object({ appId: z.uuid().optional() });
