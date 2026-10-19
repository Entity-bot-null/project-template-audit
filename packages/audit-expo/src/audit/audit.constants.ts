/** What the events say sent them (client.sdk); the package's version (connector.test.mjs checks it). */
export const SDK = { name: 'audit-expo', version: '0.2.0' } as const;

/** The queue's own SQLite file, apart from the app's key-value store. */
export const QUEUE_DATABASE = 'audit-queue.db';

/** The queue is sent at least this often while signed in and online. */
export const FLUSH_INTERVAL_MS = 30_000;
/** beforeSignOut(): how long it may hold the sign-out to send the queue. */
export const SIGN_OUT_FLUSH_MS = 3_000;

/** The API busy or failing (5xx, 429 without Retry-After): the pause doubles from this… */
export const PAUSE_FIRST_MS = 30_000;
/** …up to this. */
export const PAUSE_MAX_MS = 10 * 60_000;
/** Times the API failed on an event (5xx) before it is dropped: one it cannot take never blocks the rest. */
export const MAX_ATTEMPTS = 8;

/** An approximate position is rounded to 0.01° (about a kilometre) on the device, before it is stored. */
export const LOCATION_DECIMALS = 2;
/** What a rounded position can claim at best: an approximate one's accuracy. */
export const LOCATION_MIN_ACCURACY_M = 1_000;
/**
 * A precise position (the person allowed it: Android's fine location, iOS's
 * full accuracy) keeps five decimals, about a metre, when the system measured
 * it better than LOCATION_MIN_ACCURACY_M; Audit Hub keeps the same.
 */
export const LOCATION_PRECISE_DECIMALS = 5;
export const LOCATION_MAX_ACCURACY_M = 100_000;
/** A last known position older than this says nothing about where the phone is. */
export const LOCATION_MAX_AGE_MS = 30 * 60_000;
