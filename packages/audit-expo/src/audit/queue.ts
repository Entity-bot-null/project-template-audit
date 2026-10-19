import type { AuditQueue, MetaKey, QueuedRow, SqlDatabase } from './audit.ports';

// The device's events waiting to be sent, in their own SQLite file
// (docs/MOBILE_ARCHITECTURE.md#offline): one row per event, of one user, kept
// until the API answers for it, the user signs out, or the queue is full.
// The schema is the connector's: `pnpm connector update` brings its
// migrations, numbered by PRAGMA user_version.

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS audit_queue (
     event_id TEXT PRIMARY KEY NOT NULL,
     user_ref TEXT NOT NULL,
     occurred_at TEXT NOT NULL,
     payload TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS audit_queue_by_user ON audit_queue (user_ref, occurred_at, event_id);
   CREATE TABLE IF NOT EXISTS audit_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
];

/** The schema version this connector writes. */
export const QUEUE_SCHEMA_VERSION = MIGRATIONS.length;

interface Row {
  event_id: string;
  user_ref: string;
  occurred_at: string;
  payload: string;
  attempts: number;
}

/** Brings the database to QUEUE_SCHEMA_VERSION; refuses one written by a newer connector. */
async function migrate(db: SqlDatabase): Promise<void> {
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))
    ?.user_version;
  const version = current ?? 0;
  if (version > QUEUE_SCHEMA_VERSION) {
    throw new Error(`Audit queue schema ${String(version)} is newer than this app's`);
  }
  for (const [index, sql] of MIGRATIONS.entries()) {
    if (index < version) continue;
    // One transaction each, its version with it: a migration is applied whole or not at all.
    try {
      await db.execAsync(`BEGIN;\n${sql}\nPRAGMA user_version = ${String(index + 1)};\nCOMMIT;`);
    } catch (error) {
      await db.execAsync('ROLLBACK;').catch(() => undefined);
      throw error;
    }
  }
}

/** Placeholders for `count` values: (?, ?, ?). */
const placeholders = (count: number) => `(${Array.from({ length: count }, () => '?').join(', ')})`;

/**
 * The queue over the database `open` gives, opened and migrated on first use.
 * A database that cannot be opened fails each call; the client logs it and
 * the app goes on without the queue.
 */
export function openAuditQueue(open: () => Promise<SqlDatabase>): AuditQueue {
  let ready: Promise<SqlDatabase> | null = null;
  const db = (): Promise<SqlDatabase> => {
    ready ??= open().then(async (database) => {
      await migrate(database);
      return database;
    });
    // A failed open is tried again on the next call.
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };

  return {
    async add(row) {
      await (
        await db()
      ).runAsync(
        `INSERT OR IGNORE INTO audit_queue (event_id, user_ref, occurred_at, payload) VALUES (?, ?, ?, ?)`,
        [row.eventId, row.userRef, row.occurredAt, row.payload],
      );
    },

    async next(userRef, limit) {
      const rows = await (
        await db()
      ).getAllAsync<Row>(
        `SELECT event_id, user_ref, occurred_at, payload, attempts FROM audit_queue
         WHERE user_ref = ? ORDER BY occurred_at, event_id LIMIT ?`,
        [userRef, limit],
      );
      return rows.map((row): QueuedRow => ({
        eventId: row.event_id,
        userRef: row.user_ref,
        occurredAt: row.occurred_at,
        payload: row.payload,
        attempts: row.attempts,
      }));
    },

    async remove(eventIds) {
      if (eventIds.length === 0) return;
      await (
        await db()
      ).runAsync(`DELETE FROM audit_queue WHERE event_id IN ${placeholders(eventIds.length)}`, [
        ...eventIds,
      ]);
    },

    async failed(eventIds, max) {
      if (eventIds.length === 0) return 0;
      const database = await db();
      const list = placeholders(eventIds.length);
      await database.runAsync(
        `UPDATE audit_queue SET attempts = attempts + 1 WHERE event_id IN ${list}`,
        [...eventIds],
      );
      const { changes } = await database.runAsync(
        `DELETE FROM audit_queue WHERE attempts >= ? AND event_id IN ${list}`,
        [max, ...eventIds],
      );
      return changes;
    },

    async removeOthers(userRef) {
      const database = await db();
      const { changes } =
        userRef === null
          ? await database.runAsync('DELETE FROM audit_queue', [])
          : await database.runAsync('DELETE FROM audit_queue WHERE user_ref <> ?', [userRef]);
      return changes;
    },

    async removeUser(userRef) {
      const { changes } = await (
        await db()
      ).runAsync('DELETE FROM audit_queue WHERE user_ref = ?', [userRef]);
      return changes;
    },

    async trim(max) {
      const { changes } = await (
        await db()
      ).runAsync(
        `DELETE FROM audit_queue WHERE event_id NOT IN (
           SELECT event_id FROM audit_queue ORDER BY occurred_at DESC, event_id DESC LIMIT ?
         )`,
        [max],
      );
      return changes;
    },

    async meta(key: MetaKey) {
      const row = await (
        await db()
      ).getFirstAsync<{ value: string }>('SELECT value FROM audit_meta WHERE key = ?', [key]);
      return row?.value ?? null;
    },

    async setMeta(key: MetaKey, value: string | null) {
      const database = await db();
      if (value === null) {
        await database.runAsync('DELETE FROM audit_meta WHERE key = ?', [key]);
      } else {
        await database.runAsync(
          'INSERT INTO audit_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, value],
        );
      }
    },
  };
}
