import { CONTRACT_VERSION } from './contract/index.js';

/** Who sends: every request to Audit Hub names its connector and version. */
export const CONNECTOR = { name: 'audit-nestjs', version: '0.3.0' } as const;
export { CONTRACT_VERSION };

// Injection tokens: the connector's settings and the ports the project
// implements in audit.wiring.ts (docs/adr/0009).
export const AUDIT_CONFIG = Symbol('AUDIT_CONFIG');
export const AUDIT_STORE = Symbol('AUDIT_STORE');
export const AUDIT_TRANSPORT = Symbol('AUDIT_TRANSPORT');
export const AUDIT_LOCK = Symbol('AUDIT_LOCK');
export const AUDIT_HANDLERS = Symbol('AUDIT_HANDLERS');
export const AUDIT_CLOCK = Symbol('AUDIT_CLOCK');
/** The push sender, or null: the push module is off. */
export const AUDIT_PUSH = Symbol('AUDIT_PUSH');

/** The forwarder's pace: one batch every 2 seconds at most (the hub's per-app quota). */
export const FORWARD_INTERVAL_MS = 2_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
/** Rows claimed by a forwarder stay its own this long (crash: another picks them up). */
export const LEASE_MS = 60_000;
/** Rows numbered per round: a few batches' worth. */
export const SEQUENCE_PER_ROUND = 500;
/** First and longest wait between attempts of one event. */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_MAX_MS = 60 * 60_000;
/** Audit Hub failing or out of reach: the whole queue waits, doubling from RETRY_FIRST_MS up to this. */
export const OUTAGE_PAUSE_MAX_MS = 60_000;
/** Without a Retry-After, how long a 429 or 503 pauses the whole queue. */
export const PAUSE_DEFAULT_MS = 30_000;
/** Refused credentials or contract: retried this often, loudly. */
export const PAUSE_REFUSED_MS = 5 * 60_000;

/** Where Audit Hub's webhooks arrive: the signature covers this path. */
export const WEBHOOK_PATH = '/api/audit/webhooks';
/** Webhook deliveries already handled are remembered this long. */
export const RECEIPT_TTL_MS = 24 * 60 * 60_000;
/** A "Was it you?" prompt can be answered this long. */
export const PROMPT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Answered or expired prompts are kept this long, then swept. */
export const PROMPT_KEEP_MS = 90 * 24 * 60 * 60_000;

/**
 * Events anyone can cause at will, as often as they like (a refused
 * cross-origin request, a rate limit): the first per action, address and route
 * each window, and at most this many a window per instance.
 */
export const SAMPLE_WINDOW_MS = 60_000;
export const SAMPLE_MAX_PER_WINDOW = 100;

/** Messages per request to Expo's push service (its limit). */
export const PUSH_BATCH = 100;

/** Client events: older than this, or later than the clock skew, take the server's time. */
export const CLIENT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const CLIENT_MAX_SKEW_MS = 5 * 60_000;
