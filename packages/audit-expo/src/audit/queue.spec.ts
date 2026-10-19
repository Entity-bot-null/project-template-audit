import type { SqlDatabase } from './audit.ports';
import { memoryDatabase } from './audit.testing';
import { openAuditQueue, QUEUE_SCHEMA_VERSION } from './queue';

const row = (eventId: string, userRef: string, occurredAt: string) => ({
  eventId,
  userRef,
  occurredAt,
  payload: `{"eventId":"${eventId}"}`,
});

const T1 = '2026-10-17T12:00:01.000Z';
const T2 = '2026-10-17T12:00:02.000Z';
const T3 = '2026-10-17T12:00:03.000Z';

describe('the audit queue', () => {
  it("keeps each user's events apart, oldest first", async () => {
    const queue = openAuditQueue(() => Promise.resolve(memoryDatabase()));
    await queue.add(row('e3', 'ana', T3));
    await queue.add(row('e1', 'ana', T1));
    await queue.add(row('e2', 'luis', T2));
    await queue.add(row('e1', 'ana', T3)); // the same event twice: kept once

    expect(
      (await queue.next('ana', 10)).map((queued) => [queued.eventId, queued.attempts]),
    ).toEqual([
      ['e1', 0],
      ['e3', 0],
    ]);
    expect((await queue.next('ana', 1)).map((queued) => queued.eventId)).toEqual(['e1']);
    expect(await queue.next('luis', 10)).toEqual([
      { eventId: 'e2', userRef: 'luis', occurredAt: T2, payload: '{"eventId":"e2"}', attempts: 0 },
    ]);

    await queue.remove(['e1', 'e2']);
    await queue.remove([]);
    expect((await queue.next('ana', 10)).map((queued) => queued.eventId)).toEqual(['e3']);
    expect(await queue.next('luis', 10)).toEqual([]);
  });

  it('counts failed attempts, and drops the events that reach the limit', async () => {
    const queue = openAuditQueue(() => Promise.resolve(memoryDatabase()));
    await queue.add(row('e1', 'ana', T1));
    await queue.add(row('e2', 'ana', T2));

    expect(await queue.failed(['e1', 'e2'], 2)).toBe(0);
    expect(await queue.failed(['e1'], 2)).toBe(1);
    expect(await queue.failed([], 2)).toBe(0);
    expect(await queue.next('ana', 10)).toEqual([
      { eventId: 'e2', userRef: 'ana', occurredAt: T2, payload: '{"eventId":"e2"}', attempts: 1 },
    ]);
  });

  it("removes another user's events, one user's, or all of them", async () => {
    const queue = openAuditQueue(() => Promise.resolve(memoryDatabase()));
    for (const [id, user] of [
      ['e1', 'ana'],
      ['e2', 'luis'],
      ['e3', 'luis'],
      ['e4', 'eva'],
    ] as const) {
      await queue.add(row(id, user, T1));
    }

    expect(await queue.removeOthers('luis')).toBe(2);
    expect((await queue.next('luis', 10)).length).toBe(2);
    expect(await queue.removeUser('luis')).toBe(2);
    await queue.add(row('e5', 'ana', T1));
    expect(await queue.removeOthers(null)).toBe(1);
    expect(await queue.next('ana', 10)).toEqual([]);
  });

  it('keeps the newest events when it is full', async () => {
    const queue = openAuditQueue(() => Promise.resolve(memoryDatabase()));
    await queue.add(row('e2', 'ana', T2));
    await queue.add(row('e1', 'luis', T1));
    await queue.add(row('e3', 'ana', T3));

    expect(await queue.trim(5)).toBe(0);
    expect(await queue.trim(2)).toBe(1);
    expect(await queue.next('luis', 10)).toEqual([]);
    expect((await queue.next('ana', 10)).map((queued) => queued.eventId)).toEqual(['e2', 'e3']);
  });

  it('remembers whose it is and what it dropped', async () => {
    const queue = openAuditQueue(() => Promise.resolve(memoryDatabase()));
    expect(await queue.meta('user')).toBeNull();
    await queue.setMeta('user', 'ana');
    await queue.setMeta('user', 'luis');
    await queue.setMeta('discarded', '3');
    expect(await queue.meta('user')).toBe('luis');
    expect(await queue.meta('discarded')).toBe('3');
    await queue.setMeta('user', null);
    expect(await queue.meta('user')).toBeNull();
  });

  it('creates its tables once, survives a restart, and refuses a newer schema', async () => {
    const database = memoryDatabase();
    const first = openAuditQueue(() => Promise.resolve(database));
    await first.add(row('e1', 'ana', T1));

    const again = openAuditQueue(() => Promise.resolve(database));
    expect((await again.next('ana', 10)).map((queued) => queued.eventId)).toEqual(['e1']);
    expect(
      await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []),
    ).toEqual({ user_version: QUEUE_SCHEMA_VERSION });

    await database.execAsync(`PRAGMA user_version = ${String(QUEUE_SCHEMA_VERSION + 1)}`);
    const older = openAuditQueue(() => Promise.resolve(database));
    await expect(older.next('ana', 10)).rejects.toThrow('newer than this app');
  });

  it('opens the database again after a failure, and applies a migration whole or not at all', async () => {
    let opens = 0;
    const database = memoryDatabase();
    const failingOnce: SqlDatabase = {
      ...database,
      execAsync: (source) => {
        if (source.startsWith('BEGIN') && opens === 1) {
          // Half the migration ran when it failed.
          return database.execAsync('BEGIN; CREATE TABLE half (id INTEGER);').then(() => {
            throw new Error('disk full');
          });
        }
        return database.execAsync(source);
      },
    };
    const queue = openAuditQueue(() => {
      opens += 1;
      return opens === 2 ? Promise.reject(new Error('locked')) : Promise.resolve(failingOnce);
    });

    await expect(queue.meta('user')).rejects.toThrow('disk full');
    expect(
      await database.getAllAsync("SELECT name FROM sqlite_master WHERE name = 'half'", []),
    ).toEqual([]);
    await expect(queue.meta('user')).rejects.toThrow('locked');
    expect(await queue.meta('user')).toBeNull();
    expect(opens).toBe(3);

    // Failing before its transaction began: nothing to roll back.
    const refusing = openAuditQueue(() =>
      Promise.resolve({
        ...memoryDatabase(),
        execAsync: (source: string) =>
          source.startsWith('BEGIN')
            ? Promise.reject(new Error('read-only'))
            : database.execAsync(source),
      }),
    );
    await expect(refusing.meta('user')).rejects.toThrow('read-only');
  });

  it('migrates a database that cannot say its version', async () => {
    const database = memoryDatabase();
    const silent: SqlDatabase = {
      ...database,
      getFirstAsync: <T>(source: string, params: (string | number | null)[]) =>
        source === 'PRAGMA user_version'
          ? Promise.resolve(null)
          : database.getFirstAsync<T>(source, params),
    };
    const queue = openAuditQueue(() => Promise.resolve(silent));
    await queue.add(row('e1', 'ana', T1));
    expect((await queue.next('ana', 10)).length).toBe(1);
  });
});
