/** What the events say sent them (client.sdk); the package's version (connector.test.mjs checks it). */
export const SDK = { name: 'audit-web', version: '0.1.0' } as const;

/** The queue is sent at least this often while the page is open and signed in. */
export const FLUSH_INTERVAL_MS = 30_000;
