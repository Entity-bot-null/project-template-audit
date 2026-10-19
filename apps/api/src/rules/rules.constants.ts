// The rules' thresholds (docs/security.md#detection-rules): starting points,
// tuned with real traffic and written down when they change.

/** Provider token of the key that pseudonymizes IPs in alert group keys. */
export const RULES_KEY = Symbol('RULES_KEY');

// --- Real time ----------------------------------------------------------------
/** Events committed after this delay are not read yet: ingest transactions last at most 15 s. */
export const REALTIME_HORIZON_MS = 20_000;
export const REALTIME_INTERVAL_MS = 10_000;
export const REALTIME_BATCH = 200;
/** Faster than an airliner, accuracy radii taken off (docs/adr/0011). */
export const IMPOSSIBLE_SPEED_KMH = 900;
/** Two events closer in time than this are not compared (city-level noise). */
export const TRAVEL_MIN_SECONDS = 60;
/** The IP's place and the device's, accuracy taken off, farther apart than this. */
export const LOCATION_MISMATCH_KM = 500;
/** A sign-in after this long without any activity of the account. */
export const DORMANT_DAYS = 90;

// --- Periodic -----------------------------------------------------------------
export const PERIODIC_INTERVAL_MS = 5 * 60_000;
/** Each run looks this far back (events since the last run make it alert again). */
export const PERIODIC_WINDOW_MS = 15 * 60_000;
/** Failed sign-ins of one account. */
export const BRUTE_FORCE_ACCOUNT = 10;
/** Failed sign-ins from one IP. */
export const BRUTE_FORCE_IP = 20;
/** Distinct accounts failing from one IP: credential stuffing. */
export const STUFFING_ACCOUNTS = 10;
/** Bulk exports by one actor. */
export const MASS_EXPORT = 5;
/** Bulk deletions by one actor. */
export const MASS_DELETE = 3;
/** Reads of other users' data by one actor. */
export const MASS_READ = 50;
/** Distinct accounts using one session reference within the token reuse window. */
export const TOKEN_REUSE_ACCOUNTS = 2;
export const TOKEN_REUSE_WINDOW_MS = 3_600_000;
/** Connected applications one IP fails sign-ins against (correlation enabled). */
export const MULTI_APP_APPS = 2;
export const MULTI_APP_FAILURES = 5;
