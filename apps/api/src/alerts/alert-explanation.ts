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
  PERIODIC_WINDOW_MS,
  STUFFING_ACCOUNTS,
  TOKEN_REUSE_ACCOUNTS,
} from '../rules/rules.constants.js';

/** Why an alert fired, in words (docs/security.md#detection-rules). */
export interface AlertExplanation {
  /** What its rule looks for, as configured now; null for a rule this version does not know. */
  looksFor: string | null;
  /** What the rule saw at the alert's latest occurrence, one sentence each. */
  saw: string[];
}

export interface ExplainedAlert {
  rule: string;
  subject: string | null;
  /** The rule's summary of its latest occurrence (alerts.summary): ids, counts, signals. */
  summary: Record<string, unknown>;
  lastSeenAt: Date;
}

const WINDOW = `${String(PERIODIC_WINDOW_MS / 60_000)} minutes`;
const MASS: Record<'mass_export' | 'mass_delete' | 'mass_read', [number, string, string]> = {
  mass_export: [MASS_EXPORT, 'bulk export', 'bulk exports'],
  mass_delete: [MASS_DELETE, 'bulk deletion', 'bulk deletions'],
  mass_read: [MASS_READ, "read of other users' data", "reads of other users' data"],
};
const DAY_MS = 86_400_000;
const numbers = new Intl.NumberFormat('en');
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const many = (count: number, one: string, other = `${one}s`) =>
  `${numbers.format(count)} ${count === 1 ? one : other}`;

/** A country's name and code ("Spain (ES)"); the code alone when it is not one. */
function country(code: string): string {
  // Two capital letters are a well-formed region: DisplayNames answers it.
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const name = regions.of(code);
  return name === undefined || name === code ? code : `${name} (${code})`;
}

/** A span of minutes as a person would say it. */
function duration(minutes: number): string {
  if (minutes < 120) return many(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return hours < 48 ? many(hours, 'hour') : many(Math.round(hours / 24), 'day');
}

/** A device in words: a phone's model, or a browser on a system; undefined when nothing is known. */
export function deviceLabel(parts: {
  deviceModel?: unknown;
  browser?: unknown;
  os?: unknown;
}): string | undefined {
  const model = text(parts.deviceModel);
  if (model !== undefined) return model;
  const browser = text(parts.browser);
  const os = text(parts.os);
  if (browser !== undefined && os !== undefined) return `${browser} on ${os}`;
  return browser ?? os;
}

/**
 * Pure: an alert's rule and summary in words, the people in it by their
 * names when `names` knows them (the application's labels or Audit Hub's
 * accounts, looked up at read time: the alert itself keeps ids only).
 */
export function explainAlert(
  alert: ExplainedAlert,
  names: ReadonlyMap<string, string> = new Map(),
  /** The rule's parameters as configured now (rule-settings.service.ts); its defaults otherwise. */
  params: Readonly<Record<string, number>> = {},
): AlertExplanation {
  const { summary } = alert;
  const param = (name: string, fallback: number) => params[name] ?? fallback;
  const who = (id: string | undefined): string => {
    if (id === undefined) return 'an unknown user';
    const name = names.get(id);
    return name === undefined ? `user ${id}` : `${name} (${id})`;
  };
  const subject = alert.subject ?? text(summary.subject);
  const count = (key: string) => num(summary[key]);

  switch (alert.rule) {
    case 'suspicious_sign_in': {
      const signals = Array.isArray(summary.signals)
        ? summary.signals.filter((signal): signal is string => typeof signal === 'string')
        : [];
      return {
        looksFor: `A successful sign-in unlike the account's usual ones: a new device or country, travel faster than ${numbers.format(param('impossibleSpeedKmh', IMPOSSIBLE_SPEED_KMH))} km/h, an address of a hosting provider, or a device more than ${numbers.format(param('locationMismatchKm', LOCATION_MISMATCH_KM))} km from its address. Never an account's first sign-in.`,
        saw: [
          `${capitalized(who(subject))} signed in successfully.`,
          ...signals.map((signal) => signalSaid(signal, summary, params)),
        ],
      };
    }
    case 'dormant_account': {
      const last = text(summary.lastSeenAt);
      const lastAt = last === undefined ? undefined : new Date(last);
      const days =
        count('daysAway') ??
        (lastAt === undefined || Number.isNaN(lastAt.getTime())
          ? undefined
          : Math.floor((alert.lastSeenAt.getTime() - lastAt.getTime()) / DAY_MS));
      return {
        looksFor: `A sign-in after ${many(param('days', DORMANT_DAYS), 'day')} or more without any activity of the account: a forgotten account is a favourite target.`,
        saw: [
          days === undefined
            ? `${capitalized(who(subject))} signed in after a long time without activity.`
            : `${capitalized(who(subject))} signed in after ${many(days, 'day')} without activity${last === undefined ? '' : ` (last active on ${last.slice(0, 10)})`}.`,
        ],
      };
    }
    case 'session_reuse':
      return {
        looksFor:
          "A session token presented again after a newer one replaced it: a sign that a copy of it is in someone else's hands.",
        saw: [`A replaced session token of ${who(subject)} was presented again.`],
      };
    case 'privilege_change': {
      const by = text(summary.changedBy);
      const action = text(summary.action);
      const change =
        by !== undefined && by === subject
          ? `${capitalized(who(by))} changed their own privileges`
          : `${capitalized(who(by))} changed the privileges of ${who(subject)}`;
      return {
        looksFor:
          "Every successful change of someone's privileges (a role, a permission), so that each one is reviewed.",
        saw: [`${change}${action === undefined ? '' : ` (${action})`}.`],
      };
    }
    case 'brute_force_account': {
      const failures = count('failures');
      return {
        looksFor: `${numbers.format(param('failures', BRUTE_FORCE_ACCOUNT))} or more failed sign-ins of one account within ${WINDOW}: someone guessing its password.`,
        saw: [
          `${failures === undefined ? 'Failed sign-ins' : capitalized(many(failures, 'failed sign-in'))} of ${alert.subject === null ? "one account (known here only by its email address's pseudonym)" : who(alert.subject)} within ${WINDOW}.`,
        ],
      };
    }
    case 'brute_force_ip':
    case 'credential_stuffing': {
      const failures = count('failures');
      const accounts = count('accounts');
      const source = text(summary.source);
      return {
        looksFor:
          alert.rule === 'brute_force_ip'
            ? `${numbers.format(param('failures', BRUTE_FORCE_IP))} or more failed sign-ins from one address within ${WINDOW}.`
            : `Sign-ins of ${numbers.format(param('accounts', STUFFING_ACCOUNTS))} or more accounts failing from one address within ${WINDOW}: someone trying leaked passwords.`,
        saw: [
          `${failures === undefined ? 'Failed sign-ins' : capitalized(many(failures, 'failed sign-in'))}${accounts === undefined ? '' : ` of ${many(accounts, 'account')}`} from one address within ${WINDOW}.`,
          ...addressSaid(source),
        ],
      };
    }
    case 'multi_app_attack': {
      const failures = count('failures');
      const applications = count('applications');
      return {
        looksFor: `One address failing ${numbers.format(param('failures', MULTI_APP_FAILURES))} or more sign-ins against ${numbers.format(param('applications', MULTI_APP_APPS))} or more connected applications within ${WINDOW} (those that share their signals).`,
        saw: [
          `${failures === undefined ? 'Failed sign-ins' : capitalized(many(failures, 'failed sign-in'))} in this application from one address that fails against ${applications === undefined ? 'other applications too' : `${many(applications, 'connected application')} in all`}.`,
          ...addressSaid(text(summary.source)),
        ],
      };
    }
    case 'mass_export':
    case 'mass_delete':
    case 'mass_read': {
      const [fallback, noun, plural] = MASS[alert.rule];
      const threshold = param('count', fallback);
      const found = count('count');
      return {
        looksFor: `${numbers.format(threshold)} or more ${plural} by one user within ${WINDOW}.`,
        saw: [
          `${found === undefined ? capitalized(plural) : capitalized(many(found, noun, plural))} by ${who(subject)} within ${WINDOW}.`,
        ],
      };
    }
    case 'token_reuse': {
      const accounts = count('accounts');
      const session = text(summary.session);
      return {
        looksFor: `One session used by ${numbers.format(param('accounts', TOKEN_REUSE_ACCOUNTS))} or more accounts within an hour: a session stolen or shared.`,
        saw: [
          `${accounts === undefined ? 'Several accounts' : capitalized(many(accounts, 'account'))} used the same session${session === undefined ? '' : ` (reference ${session}…)`} within an hour.`,
        ],
      };
    }
    case 'source_silent': {
      const minutesSilent = count('silentMinutes');
      const timeout = count('timeoutSeconds');
      return {
        looksFor:
          "No heartbeat from any instance of the application's connector for longer than its heartbeat timeout, after one was seen. Resolved by itself when one arrives.",
        saw: [
          `No heartbeat ${minutesSilent === undefined ? 'for a while' : `for ${duration(minutesSilent)}`}${timeout === undefined ? '' : ` (the timeout is ${many(timeout, 'second')})`}: the connector stopped, or cannot reach Audit Hub. Its events wait in its queue, or are lost if it was stopped for good.`,
        ],
      };
    }
    case 'source_backlog': {
      const age = count('oldestAgeSeconds');
      const queued = count('queueSize');
      const retrying = count('retrying');
      return {
        looksFor: `A connector whose oldest queued event has waited longer than ${many(param('oldestAgeSeconds', 900), 'second')} (it says so in its heartbeats). Resolved by itself when the queue drains.`,
        saw: [
          `${queued === undefined ? 'Events' : capitalized(many(queued, 'event'))} queued, the oldest waiting ${age === undefined ? 'too long' : duration(Math.round(age / 60))}${retrying === undefined || retrying === 0 ? '' : `, ${many(retrying, 'event')} being retried`}: delayed, not lost.`,
        ],
      };
    }
    case 'ingest_rejections': {
      const rejected = count('rejected');
      const reasons = Array.isArray(summary.reasons)
        ? summary.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [];
      return {
        looksFor: `${numbers.format(param('count', 20))} or more events refused by validation within 15 minutes. Resolved by itself when they stop.`,
        saw: [
          `${rejected === undefined ? 'Events' : capitalized(many(rejected, 'event'))} refused within 15 minutes${reasons.length === 0 ? '' : `, for: ${reasons.join(', ')}`}. A refused event is never stored: the application's connector logs which.`,
        ],
      };
    }
    case 'coverage_gap': {
      const missing = count('missingEvents');
      const gaps = count('gaps');
      return {
        looksFor: `Events the connector numbered that have not arrived, missing for longer than ${many(param('graceMinutes', 10), 'minute')}: a loss of coverage inferred from the sequence numbers, never from silence. Resolved by itself when they arrive.`,
        saw: [
          `${missing === undefined ? 'Events' : capitalized(many(missing, 'event'))} missing${gaps === undefined ? '' : ` in ${many(gaps, 'gap')}`} of the sequence: numbered by the connector, never received.`,
        ],
      };
    }
    case 'integrity_failure': {
      const failures = count('failures');
      return {
        looksFor:
          'A verification of the log that found records not matching their hash, their seal or their chain. Never resolved by itself.',
        saw: [
          `${failures === undefined ? 'Records' : capitalized(many(failures, 'record'))} that do not match: possible tampering, or a fault to explain. The verification's report (Integrity) names each; the events behind this alert are its sample.`,
        ],
      };
    }
    default:
      return { looksFor: null, saw: [] };
  }
}

/** One signal of a suspicious sign-in in words, with the figures the rule kept. */
function signalSaid(
  signal: string,
  summary: Record<string, unknown>,
  params: Readonly<Record<string, number>>,
): string {
  switch (signal) {
    case 'new_device': {
      const device = deviceLabel(summary);
      return `New device: one this account had not used before${device === undefined ? '' : ` (${device})`}.`;
    }
    case 'new_country': {
      const code = text(summary.country);
      return `New country: one this account had not signed in from before${code === undefined ? '' : ` (${country(code)})`}.`;
    }
    case 'impossible_travel': {
      const km = num(summary.travelKm);
      const minutes = num(summary.travelMinutes);
      const speed = num(summary.travelSpeedKmh);
      return km === undefined || minutes === undefined || speed === undefined
        ? `Impossible travel: too far from where the account was shortly before to have got there (faster than ${numbers.format(params.impossibleSpeedKmh ?? IMPOSSIBLE_SPEED_KMH)} km/h).`
        : `Impossible travel: ${numbers.format(km)} km from where the account was ${duration(minutes)} before, ${numbers.format(speed)} km/h (faster than an airliner).`;
    }
    case 'hosting_ip':
      return 'Hosting address: one of a hosting provider (a server, a VPN or a proxy), not of a home, an office or a phone network.';
    case 'location_mismatch': {
      const km = num(summary.mismatchKm);
      return `Location mismatch: the device said it was ${km === undefined ? `more than ${numbers.format(params.locationMismatchKm ?? LOCATION_MISMATCH_KM)} km` : `${numbers.format(km)} km`} from where its address is.`;
    }
    default:
      return `${capitalized(signal.replaceAll('_', ' '))}.`;
  }
}

/** What the panel may say of an address: the alert keeps its pseudonym, each event the address. */
function addressSaid(source: string | undefined): string[] {
  return source === undefined
    ? []
    : [
        `The alert keeps only a pseudonym of the address (${source}); each event behind it has the address itself while it is kept.`,
      ];
}

function capitalized(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
