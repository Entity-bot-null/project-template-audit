import { z } from 'zod';
import { SEVERITY_VALUES } from './alert.schemas.js';

// The detection rules and the escalation policies, as administrators tune
// them (alerts/rule-catalog.ts, escalation_policies).

const ParamSchema = z.object({
  name: z.string(),
  label: z.string(),
  unit: z.string(),
  default: z.int(),
  min: z.int(),
  max: z.int(),
});

export const DetectionRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What it detects and how: its real capabilities. */
  description: z.string(),
  /** realtime, periodic, health or integrity. */
  kind: z.string(),
  /** Its own severity; null when it decides per detection. */
  severity: z.enum(SEVERITY_VALUES).nullable(),
  grouping: z.string(),
  window: z.string().nullable(),
  /** Resolved by itself once the condition clears. */
  autoResolves: z.boolean(),
  params: z.array(ParamSchema),
  settings: z.object({
    enabled: z.boolean(),
    /** In place of its own severity; null: its own. */
    severity: z.enum(SEVERITY_VALUES).nullable(),
    params: z.record(z.string(), z.int()),
    updatedById: z.uuid().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  }),
});
export type DetectionRuleResponse = z.infer<typeof DetectionRuleSchema>;

export const DetectionRuleListSchema = z.object({
  items: z.array(DetectionRuleSchema),
  /** A rule's new alerts in one application within an hour, past which they fold into one. */
  maxNewAlertsPerHour: z.int(),
});

export const UpdateDetectionRuleSchema = z.object({
  enabled: z.boolean(),
  severity: z.enum(SEVERITY_VALUES).nullable(),
  /** Whole numbers within each parameter's bounds; a missing one keeps its default. */
  params: z.record(z.string().regex(/^[a-zA-Z]{1,40}$/), z.int()).default({}),
});
export type UpdateDetectionRuleDto = z.infer<typeof UpdateDetectionRuleSchema>;

export const ESCALATION_CHANNELS = ['email', 'chat'] as const;

export const EscalationPolicySchema = z.object({
  severity: z.enum(SEVERITY_VALUES),
  enabled: z.boolean(),
  /** After how long without an acknowledgement the first escalation goes out. */
  firstAfterMinutes: z.int().min(1).max(10080),
  /** Then how often again, while still unacknowledged. */
  repeatEveryMinutes: z.int().min(5).max(10080),
  maxEscalations: z.int().min(1).max(10),
  /** email: the administrators and the application's auditors; chat: the Slack and Teams channels. */
  channels: z.array(z.enum(ESCALATION_CHANNELS)).max(2),
  updatedById: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});
export type EscalationPolicyResponse = z.infer<typeof EscalationPolicySchema>;

export const EscalationPolicyListSchema = z.object({
  items: z.array(EscalationPolicySchema),
  /** What the deployment can send through: email (SMTP set) and the chat channels configured. */
  available: z.object({ email: z.boolean(), chat: z.array(z.string()) }),
});

export const UpdateEscalationPolicySchema = EscalationPolicySchema.pick({
  enabled: true,
  firstAfterMinutes: true,
  repeatEveryMinutes: true,
  maxEscalations: true,
  channels: true,
}).refine((value) => new Set(value.channels).size === value.channels.length, {
  message: 'A channel once',
  path: ['channels'],
});
export type UpdateEscalationPolicyDto = z.infer<typeof UpdateEscalationPolicySchema>;
