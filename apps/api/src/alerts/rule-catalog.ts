import type { AuditSeverity } from '../prisma/generated/client.js';
import {
  BRUTE_FORCE_ACCOUNT,
  BRUTE_FORCE_IP,
  DORMANT_DAYS,
  IMPOSSIBLE_SPEED_KMH,
  LOCATION_MISMATCH_KM,
  MASS_DELETE,
  MASS_EXPORT,
  MASS_READ,
  MULTI_APP_APPS,
  MULTI_APP_FAILURES,
  STUFFING_ACCOUNTS,
  TOKEN_REUSE_ACCOUNTS,
} from '../rules/rules.constants.js';

// The detection rules (docs/security.md#detection-rules): what each detects,
// in words that claim no more than it does, its severity, how its detections
// group into one alert, and the parameters an administrator may tune within
// bounds (detection_rule_settings). The rules themselves live in
// apps/api/src/rules; they read their parameters through RuleSettingsService.

/** A tunable parameter: a whole number within bounds. */
export interface RuleParam {
  name: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
}

export interface RuleDefinition {
  id: string;
  name: string;
  /** What it detects and how: its real capabilities, nothing more. */
  description: string;
  /** realtime: on every event; periodic: every 5 minutes over windows; health: every minute over the sources' state; integrity: after each verification. */
  kind: 'realtime' | 'periodic' | 'health' | 'integrity';
  /** Its severity; null when it decides per detection (no override then). */
  severity: AuditSeverity | null;
  /** How its detections become one alert (the group key). */
  grouping: string;
  window: string | null;
  /** Resolved by itself once the condition clears. */
  autoResolves: boolean;
  params: readonly RuleParam[];
}

/** A rule's new alerts in an application within an hour, past which they fold into one. */
export const MAX_NEW_ALERTS_PER_HOUR = 20;

const WINDOW_15 = '15 minutes, every 5 minutes';

export const RULE_CATALOG: readonly RuleDefinition[] = [
  {
    id: 'suspicious_sign_in',
    name: 'Suspicious sign-in',
    description:
      "A successful sign-in unlike the account's earlier ones: a device or a country never seen with it, travel between its last place and this one faster than the speed below (accuracy radii taken off), an address of a hosting provider, or a device far from its address. It compares with what Audit Hub remembers of the account; an account's first sign-in is never flagged. High for impossible travel, or a new device from a new country; medium otherwise.",
    kind: 'realtime',
    severity: null,
    grouping: 'One alert per account',
    window: null,
    autoResolves: false,
    params: [
      {
        name: 'impossibleSpeedKmh',
        label: 'Impossible travel above',
        unit: 'km/h',
        default: IMPOSSIBLE_SPEED_KMH,
        min: 300,
        max: 3000,
      },
      {
        name: 'locationMismatchKm',
        label: 'Device farther from its address than',
        unit: 'km',
        default: LOCATION_MISMATCH_KM,
        min: 50,
        max: 5000,
      },
    ],
  },
  {
    id: 'dormant_account',
    name: 'Dormant account back',
    description:
      'A sign-in after this many days or more without any activity of the account: a forgotten account is a favourite target.',
    kind: 'realtime',
    severity: 'medium',
    grouping: 'One alert per account',
    window: null,
    autoResolves: false,
    params: [
      {
        name: 'days',
        label: 'Without activity for',
        unit: 'days',
        default: DORMANT_DAYS,
        min: 7,
        max: 730,
      },
    ],
  },
  {
    id: 'session_reuse',
    name: 'Session token reused',
    description:
      "The application reported a session token presented again after a newer one replaced it (auth.session_reuse): a copy of it may be in someone else's hands.",
    kind: 'realtime',
    severity: 'high',
    grouping: 'One alert per account',
    window: null,
    autoResolves: false,
    params: [],
  },
  {
    id: 'privilege_change',
    name: 'Privileges changed',
    description:
      "Every successful change of someone's privileges (iam.privilege_changed), so that each one is reviewed.",
    kind: 'realtime',
    severity: 'medium',
    grouping: 'One alert per account whose privileges changed',
    window: null,
    autoResolves: false,
    params: [],
  },
  {
    id: 'brute_force_account',
    name: 'Failed sign-ins of one account',
    description: 'At least this many failed sign-ins of one account within the window.',
    kind: 'periodic',
    severity: 'high',
    grouping: 'One alert per account',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      {
        name: 'failures',
        label: 'Failed sign-ins',
        unit: 'events',
        default: BRUTE_FORCE_ACCOUNT,
        min: 3,
        max: 1000,
      },
    ],
  },
  {
    id: 'brute_force_ip',
    name: 'Failed sign-ins from one address',
    description:
      'At least this many failed sign-ins from one IP address within the window. The alert names the address by a keyed pseudonym; the events behind it have the address.',
    kind: 'periodic',
    severity: 'high',
    grouping: 'One alert per address',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      {
        name: 'failures',
        label: 'Failed sign-ins',
        unit: 'events',
        default: BRUTE_FORCE_IP,
        min: 5,
        max: 10000,
      },
    ],
  },
  {
    id: 'credential_stuffing',
    name: 'Many accounts failing from one address',
    description:
      'Sign-ins of at least this many distinct accounts failing from one IP address within the window: the pattern of trying leaked passwords.',
    kind: 'periodic',
    severity: 'critical',
    grouping: 'One alert per address',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      {
        name: 'accounts',
        label: 'Distinct accounts',
        unit: 'accounts',
        default: STUFFING_ACCOUNTS,
        min: 3,
        max: 1000,
      },
    ],
  },
  {
    id: 'multi_app_attack',
    name: 'One address against several applications',
    description:
      'One IP address failing sign-ins against at least this many connected applications (those that share their signals: correlation on) within the window, with at least this many failures in all.',
    kind: 'periodic',
    severity: 'high',
    grouping: 'One alert per address and application',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      {
        name: 'applications',
        label: 'Applications',
        unit: 'applications',
        default: MULTI_APP_APPS,
        min: 2,
        max: 20,
      },
      {
        name: 'failures',
        label: 'Failed sign-ins in all',
        unit: 'events',
        default: MULTI_APP_FAILURES,
        min: 2,
        max: 1000,
      },
    ],
  },
  {
    id: 'mass_export',
    name: 'Bulk exports',
    description:
      'At least this many bulk exports (data.bulk_export) by one user within the window.',
    kind: 'periodic',
    severity: 'high',
    grouping: 'One alert per user',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      { name: 'count', label: 'Exports', unit: 'events', default: MASS_EXPORT, min: 1, max: 1000 },
    ],
  },
  {
    id: 'mass_delete',
    name: 'Bulk deletions',
    description:
      'At least this many bulk deletions (data.bulk_delete) by one user within the window.',
    kind: 'periodic',
    severity: 'high',
    grouping: 'One alert per user',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      {
        name: 'count',
        label: 'Deletions',
        unit: 'events',
        default: MASS_DELETE,
        min: 1,
        max: 1000,
      },
    ],
  },
  {
    id: 'mass_read',
    name: "Reads of other users' data",
    description:
      "At least this many reads of other users' data (data.read_other_user) by one user within the window.",
    kind: 'periodic',
    severity: 'medium',
    grouping: 'One alert per user',
    window: WINDOW_15,
    autoResolves: false,
    params: [
      { name: 'count', label: 'Reads', unit: 'events', default: MASS_READ, min: 5, max: 100000 },
    ],
  },
  {
    id: 'token_reuse',
    name: 'One session, several accounts',
    description:
      'One session reference used by at least this many distinct accounts within an hour: a session stolen or shared.',
    kind: 'periodic',
    severity: 'critical',
    grouping: 'One alert per session reference',
    window: '1 hour, every 5 minutes',
    autoResolves: false,
    params: [
      {
        name: 'accounts',
        label: 'Distinct accounts',
        unit: 'accounts',
        default: TOKEN_REUSE_ACCOUNTS,
        min: 2,
        max: 100,
      },
    ],
  },
  {
    id: 'source_silent',
    name: 'Source disconnected',
    description:
      "No heartbeat from any instance of the application's connector for longer than the application's heartbeat timeout (its settings), after one was seen: the connector stopped, or cannot reach Audit Hub. An application that never sent one is not flagged, nor one that sends heartbeats without events (idle, not lost).",
    kind: 'health',
    severity: 'high',
    grouping: 'One alert per application',
    window: null,
    autoResolves: true,
    params: [],
  },
  {
    id: 'source_backlog',
    name: 'Source delayed',
    description:
      'The connector says (in its heartbeat) that its oldest queued event has waited longer than this: events are delayed, not lost, until it drains or reports them discarded.',
    kind: 'health',
    severity: 'medium',
    grouping: 'One alert per application',
    window: null,
    autoResolves: true,
    params: [
      {
        name: 'oldestAgeSeconds',
        label: 'Oldest queued event older than',
        unit: 'seconds',
        default: 900,
        min: 60,
        max: 86400,
      },
    ],
  },
  {
    id: 'ingest_rejections',
    name: 'Events refused by validation',
    description:
      'At least this many events refused by validation within 15 minutes (the reasons counted in the alert; a refused event is never stored). Retried rejections (an unknown catalog version) do not count.',
    kind: 'health',
    severity: 'medium',
    grouping: 'One alert per application',
    window: '15 minutes, every minute',
    autoResolves: true,
    params: [
      { name: 'count', label: 'Refused events', unit: 'events', default: 20, min: 1, max: 100000 },
    ],
  },
  {
    id: 'coverage_gap',
    name: 'Events missing from a sequence',
    description:
      'Events the connector numbered and Audit Hub has not received, missing for longer than this: an inferred loss of coverage, from the sequence numbers, never from silence alone. Resolved by itself when they arrive.',
    kind: 'health',
    severity: 'high',
    grouping: 'One alert per application',
    window: null,
    autoResolves: true,
    params: [
      {
        name: 'graceMinutes',
        label: 'Missing for longer than',
        unit: 'minutes',
        default: 10,
        min: 1,
        max: 1440,
      },
    ],
  },
  {
    id: 'integrity_failure',
    name: 'Integrity verification failed',
    description:
      'A verification of the log found records that do not match their hash, their seal or their chain: possible tampering, or a fault to explain. Never resolved by itself.',
    kind: 'integrity',
    severity: 'critical',
    grouping: 'One alert per application',
    window: null,
    autoResolves: false,
    params: [],
  },
];

export const RULES: ReadonlyMap<string, RuleDefinition> = new Map(
  RULE_CATALOG.map((rule) => [rule.id, rule]),
);

/** A rule's parameters with their defaults, the stored ones that are still valid in place. */
export function paramsOf(rule: RuleDefinition, stored: unknown): Record<string, number> {
  const values =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    rule.params.map((param) => {
      const value = Object.hasOwn(values, param.name) ? values[param.name] : undefined;
      const valid =
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= param.min &&
        value <= param.max;
      return [param.name, valid ? value : param.default];
    }),
  );
}
