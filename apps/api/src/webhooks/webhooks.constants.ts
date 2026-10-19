// The webhook outbox's timing (docs/adr/0013), the mail outbox's pattern.

/** A worker holds a delivery this long before another may take it over. */
export const WEBHOOK_LEASE_MS = 60_000;
/** Looks for due deliveries this often (and at once after a commit). */
export const WEBHOOK_POLL_INTERVAL_MS = 5_000;
export const WEBHOOK_STATS_INTERVAL_MS = 30_000;
export const WEBHOOK_SWEEP_INTERVAL_MS = 3_600_000;
/** Attempts before a delivery is given up on. */
export const WEBHOOK_MAX_ATTEMPTS = 12;
/** Undelivered after this long: dropped, the application was down too long. */
export const WEBHOOK_TTL_MS = 24 * 3_600_000;
/** Per attempt. */
export const WEBHOOK_TIMEOUT_MS = 5_000;
/** Finished deliveries are kept this long for the admin pages. */
export const WEBHOOK_RETENTION_DAYS = 30;
export const WEBHOOK_SHUTDOWN_GRACE_MS = 5_000;

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 3_600_000;

/**
 * The wait after the `attempts`-th failure (1-based): 30 s doubling to an hour,
 * with equal jitter (half the delay plus a random share of the other half).
 */
export function webhookRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.floor(attempts) - 1);
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
  return Math.round(delay / 2 + random() * (delay / 2));
}
