import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessService } from '../access/app-access.service.js';
import type { RequestUser } from '../common/types/request-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  AlertStreamService,
  cursorOf,
  cursorTime,
  MAX_STREAMS_PER_USER,
  STREAM_LOOKBACK_MS,
} from './alert-stream.service.js';
import type { AlertRow, AlertsService } from './alerts.service.js';

const SHOP = '0199e0b1-0000-7000-8000-0000000000a1';
const BANK = '0199e0b1-0000-7000-8000-0000000000a2';
const NOW = Date.parse('2026-10-20T10:00:00.000Z');
const ADMIN: RequestUser = { id: '0199e0b1-0000-7000-8000-0000000000ad', role: 'admin' };
const AUDITOR: RequestUser = { id: '0199e0b1-0000-7000-8000-0000000000bb', role: 'auditor' };

/** A response that keeps what the stream writes. */
function fakeResponse() {
  const listeners: Record<string, () => void> = {};
  const res = {
    chunks: [] as string[],
    headers: {} as Record<string, string>,
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    writableLength: 0,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    set: vi.fn((headers: Record<string, string>) => {
      Object.assign(res.headers, headers);
      return res;
    }),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      res.chunks.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    destroy: vi.fn(() => {
      res.destroyed = true;
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
      return res;
    }),
    close: () => listeners.close?.(),
    /** The events written, parsed. */
    events: () =>
      res.chunks
        .filter((chunk) => chunk.includes('event: '))
        .map((chunk) => ({
          id: /^id: (.*)$/m.exec(chunk)?.[1],
          event: /^event: (.*)$/m.exec(chunk)?.[1],
          data: JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? 'null') as Record<string, unknown>,
        })),
  };
  return res;
}

const row = (id: string, appId: string, updatedAt: number) =>
  ({
    id,
    appId,
    rule: 'brute_force_ip',
    updatedAt: new Date(updatedAt),
    app: { slug: 'x' },
  }) as unknown as AlertRow;

function setup() {
  const prisma = {
    alert: { findMany: vi.fn((_args: unknown) => Promise.resolve([] as AlertRow[])) },
    user: {
      findUnique: vi.fn((_args: unknown) =>
        Promise.resolve({
          disabledAt: null,
          role: 'auditor',
          _count: { appAssignments: 1 },
        } as unknown),
      ),
    },
  };
  const access = {
    visibleApps: vi.fn((user: RequestUser) =>
      Promise.resolve(user.role === 'admin' ? 'all' : [SHOP]),
    ),
  };
  const alerts = {
    responses: vi.fn((rows: AlertRow[]) =>
      Promise.resolve(
        rows.map((alert) => ({
          id: alert.id,
          appId: alert.appId,
          updatedAt: alert.updatedAt.toISOString(),
        })),
      ),
    ),
  };
  const service = new AlertStreamService(
    prisma as unknown as PrismaService,
    access as unknown as AppAccessService,
    alerts as unknown as AlertsService,
  );
  return { prisma, access, alerts, service };
}

/** Lets the stream's own first read, started without waiting, finish. */
const flush = async () => {
  for (let step = 0; step < 10; step++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cursors', () => {
  it("name a change's time and alert, and give the time back; anything else is no cursor", () => {
    const cursor = cursorOf({ updatedAt: '2026-10-20T09:00:00.000Z', id: 'a1' });
    expect(cursor).toBe('2026-10-20T09:00:00.000Z|a1');
    expect(cursorTime(cursor)?.toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(cursorTime('nonsense')).toBeUndefined();
    expect(cursorTime(undefined)).toBeUndefined();
  });
});

describe('AlertStreamService', () => {
  it('opens an event stream no proxy buffers, and says when it is caught up', async () => {
    const { service } = setup();
    const res = fakeResponse();
    await service.open(ADMIN, res as unknown as Response, undefined);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    expect(res.chunks[0]).toBe('retry: 5000\n\n');
    expect(res.events().map((event) => event.event)).toEqual(['ready']);
    expect(service.size).toBe(1);
    res.close();
    expect(service.size).toBe(0);
    service.onModuleDestroy();
  });

  it('opens at most 5 streams per account', async () => {
    const { service } = setup();
    for (let index = 0; index < MAX_STREAMS_PER_USER; index++) {
      await service.open(AUDITOR, fakeResponse() as unknown as Response, undefined);
    }
    const refused = service.open(AUDITOR, fakeResponse() as unknown as Response, undefined);
    await expect(refused).rejects.toBeInstanceOf(HttpException);
    await expect(refused).rejects.toMatchObject({ status: 429 });
    await service.open(ADMIN, fakeResponse() as unknown as Response, undefined);
    service.onModuleDestroy();
  });

  it('sends each change once, to whoever may see its application only', async () => {
    const { prisma, service } = setup();
    const admin = fakeResponse();
    const auditor = fakeResponse();
    // The first read, when the first listener comes, learns what was there:
    // nobody hears the past as news.
    prisma.alert.findMany.mockResolvedValueOnce([row('a1', SHOP, NOW - 60_000)]);
    await service.open(ADMIN, admin as unknown as Response, undefined);
    await service.open(AUDITOR, auditor as unknown as Response, undefined);
    await flush();
    expect(admin.events().filter((event) => event.event === 'alert')).toHaveLength(0);

    prisma.alert.findMany.mockResolvedValueOnce([
      row('a1', SHOP, NOW - 60_000), // unchanged
      row('a2', SHOP, NOW - 1_000),
      row('b1', BANK, NOW - 1_000),
    ]);
    await service.poll(NOW);
    const ids = (res: ReturnType<typeof fakeResponse>) =>
      res
        .events()
        .filter((event) => event.event === 'alert')
        .map((event) => (event.data.alert as { id: string }).id);
    expect(ids(admin)).toEqual(['a2', 'b1']);
    expect(ids(auditor)).toEqual(['a2']); // not the bank's: not assigned to it
    expect(auditor.events().find((event) => event.event === 'alert')).toMatchObject({
      id: `${new Date(NOW - 1_000).toISOString()}|a2`,
      data: { replay: false },
    });

    // A later change of the same alert is news again; the same one is not.
    prisma.alert.findMany.mockResolvedValueOnce([
      row('a2', SHOP, NOW - 1_000),
      row('a2b', SHOP, NOW),
    ]);
    await service.poll(NOW + 2_000);
    expect(ids(auditor)).toEqual(['a2', 'a2b']);
    expect(prisma.alert.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { updatedAt: { gt: new Date(NOW + 2_000 - STREAM_LOOKBACK_MS) } },
      }),
    );
    service.onModuleDestroy();
  });

  it('hears a change made while the first listener connected as news, not as the past', async () => {
    const { prisma, service } = setup();
    const res = fakeResponse();
    prisma.alert.findMany.mockResolvedValueOnce([
      row('old', SHOP, NOW - 60_000),
      row('fresh', SHOP, NOW - 2_000),
    ]);
    await service.open(ADMIN, res as unknown as Response, undefined);
    await flush();
    expect(
      res
        .events()
        .filter((event) => event.event === 'alert')
        .map((event) => (event.data.alert as { id: string }).id),
    ).toEqual(['fresh']);
    service.onModuleDestroy();
  });

  it('replays what changed after the last event it got, within its applications', async () => {
    const { prisma, service } = setup();
    const res = fakeResponse();
    const cursor = cursorOf({ updatedAt: new Date(NOW - 60_000).toISOString(), id: 'a1' });
    prisma.alert.findMany.mockResolvedValueOnce([row('a2', SHOP, NOW - 30_000)]);
    await service.open(AUDITOR, res as unknown as Response, cursor);
    expect(prisma.alert.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        updatedAt: { gt: new Date(NOW - 60_000 - STREAM_LOOKBACK_MS) },
        appId: { in: [SHOP] },
      },
    });
    expect(res.events().map((event) => [event.event, event.data.replay])).toEqual([
      ['alert', true],
      ['ready', undefined],
    ]);
    service.onModuleDestroy();
  });

  it('asks a listener away too long to reload, rather than replay without end', async () => {
    const { prisma, service } = setup();
    const res = fakeResponse();
    prisma.alert.findMany.mockResolvedValueOnce(
      Array.from({ length: 201 }, (_, index) => row(`a${String(index)}`, SHOP, NOW - 1_000)),
    );
    await service.open(
      ADMIN,
      res as unknown as Response,
      cursorOf({ updatedAt: new Date(NOW - 86_400_000).toISOString(), id: 'x' }),
    );
    expect(res.events().map((event) => event.event)).toEqual(['resync', 'ready']);
    service.onModuleDestroy();
  });

  it('ends the stream of a person who lost access, at the next check', async () => {
    const { prisma, service } = setup();
    const res = fakeResponse();
    await service.open(AUDITOR, res as unknown as Response, undefined);
    await service.poll(NOW); // primes
    prisma.user.findUnique.mockResolvedValueOnce({
      disabledAt: new Date(NOW),
      role: 'auditor',
      _count: { appAssignments: 1 },
    });
    prisma.alert.findMany.mockResolvedValueOnce([row('a3', SHOP, NOW + 60_000)]);
    await service.poll(NOW + 61_000);
    expect(res.events().at(-1)).toMatchObject({ event: 'end', data: { reason: 'access' } });
    expect(res.writableEnded).toBe(true);
    expect(res.events().some((event) => event.event === 'alert')).toBe(false);
    service.onModuleDestroy();
  });

  it('renews every stream after 10 minutes, and drops a reader too slow to keep up', async () => {
    const { prisma, service } = setup();
    const res = fakeResponse();
    await service.open(ADMIN, res as unknown as Response, undefined);
    vi.advanceTimersByTime(10 * 60_000);
    expect(res.events().at(-1)).toMatchObject({ event: 'end', data: { reason: 'renew' } });

    const slow = fakeResponse();
    await service.open(ADMIN, slow as unknown as Response, undefined);
    await service.poll(NOW);
    slow.writableLength = 2_000_000;
    prisma.alert.findMany.mockResolvedValueOnce([row('a4', SHOP, NOW + 1)]);
    await service.poll(NOW + 2_000);
    expect(slow.destroyed).toBe(true);
    expect(service.size).toBe(0);
    service.onModuleDestroy();
  });
});
