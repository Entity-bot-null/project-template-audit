import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { integrityKeyring } from './integrity-keys.js';
import {
  checkpointDigest,
  decodeLeaves,
  GENESIS_HASH,
  hex,
  hmac,
  sealHash,
  sha256,
} from './seal-math.js';
import { MAX_SEAL_EVENTS, SealerService } from './sealer.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const STREAM = { appId: APP, category: 'security' };
const HORIZON = new Date('2026-10-14T11:58:00.000Z');
const keys = integrityKeyring({
  key: 'k'.repeat(64),
  previous: undefined,
  fallback: 'f'.repeat(64),
});

const eventPk = (n: number) => `0199e0b1-6a2c-7d9e-9f1a-${n.toString(16).padStart(12, '0')}`;
const row = (n: number, at = new Date(HORIZON.getTime() - 60_000 + n)) => ({
  id: eventPk(n),
  recordedAt: at,
  contentHash: sha256(`event ${String(n)}`),
});

function fakePrisma() {
  const tx = {
    $queryRaw: vi.fn(),
    integritySeal: {
      findFirst: vi.fn(() => Promise.resolve(null as unknown)),
      create: vi.fn((_args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'seal-1' }),
      ),
    },
    integritySealLeaves: {
      create: vi.fn((_args: { data: { sealId: string; leaves: Uint8Array } }) =>
        Promise.resolve({}),
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])),
    integrityCheckpoint: {
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cp-1' })),
    },
  };
  const service = new SealerService(prisma as unknown as PrismaService, keys);
  return { prisma, tx, service };
}

describe('SealerService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a stream another instance is sealing, and a stream with nothing to seal', async () => {
    const { tx, service } = fakePrisma();
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false, horizon: HORIZON }]);
    await expect(service.sealStream(STREAM)).resolves.toBe(false);
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true, horizon: HORIZON }])
      .mockResolvedValueOnce([]);
    await expect(service.sealStream(STREAM)).resolves.toBe(false);
    expect(tx.integritySeal.create).not.toHaveBeenCalled();
  });

  it('starts a chain at the genesis hash and signs the seal', async () => {
    const { tx, service } = fakePrisma();
    const rows = [row(1), row(2)];
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true, horizon: HORIZON }])
      .mockResolvedValueOnce(rows);
    await expect(service.sealStream(STREAM)).resolves.toBe(true);
    const data = tx.integritySeal.create.mock.calls[0]?.[0].data ?? {};
    const leaves = tx.integritySealLeaves.create.mock.calls[0]?.[0].data.leaves ?? new Uint8Array();
    expect(decodeLeaves(leaves)).toEqual(
      rows.map((event) => ({ eventPk: event.id, contentHash: event.contentHash })),
    );
    const expected = sealHash({
      appId: APP,
      category: 'security',
      sealNo: 1n,
      windowFrom: rows[0]?.recordedAt ?? HORIZON,
      windowTo: HORIZON,
      eventCount: 2,
      leavesDigest: sha256(leaves),
      prevHash: GENESIS_HASH,
    });
    expect(data).toMatchObject({
      sealNo: 1n,
      windowFrom: rows[0]?.recordedAt,
      windowTo: HORIZON,
      eventCount: 2,
      keyId: keys.current.id,
    });
    expect(hex(data.sealHash as Uint8Array)).toBe(hex(expected));
    expect(hex(data.signature as Uint8Array)).toBe(hex(hmac(keys.current.key, expected)));
    expect(hex(data.prevHash as Uint8Array)).toBe(hex(GENESIS_HASH));
  });

  it('chains the next seal to the last one, from where it ended', async () => {
    const { tx, service } = fakePrisma();
    const last = {
      sealNo: 4n,
      windowTo: new Date(HORIZON.getTime() - 120_000),
      sealHash: sha256('seal 4'),
    };
    tx.integritySeal.findFirst.mockResolvedValueOnce(last);
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true, horizon: HORIZON }])
      .mockResolvedValueOnce([row(1)]);
    await service.sealStream(STREAM);
    const data = tx.integritySeal.create.mock.calls[0]?.[0].data ?? {};
    expect(data).toMatchObject({ sealNo: 5n, windowFrom: last.windowTo, windowTo: HORIZON });
    expect(hex(data.prevHash as Uint8Array)).toBe(hex(last.sealHash));
  });

  it('cuts a full window at the first event that does not fit, never inside an instant', async () => {
    const { tx, service } = fakePrisma();
    const base = HORIZON.getTime() - 100_000;
    const rows = Array.from({ length: MAX_SEAL_EVENTS + 1 }, (_, n) =>
      row(n, new Date(base + Math.floor(n / 2))),
    );
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true, horizon: HORIZON }])
      .mockResolvedValueOnce(rows);
    await expect(service.sealStream(STREAM)).resolves.toBe(true);
    const data = tx.integritySeal.create.mock.calls[0]?.[0].data ?? {};
    // The last row shares its instant with the one before it: both wait.
    expect(data.eventCount).toBe(MAX_SEAL_EVENTS);
    expect(data.windowTo).toEqual(rows[MAX_SEAL_EVENTS]?.recordedAt);

    // A single instant holding more than a seal: nothing is sealed (it never splits).
    const same = Array.from({ length: MAX_SEAL_EVENTS + 1 }, (_, n) => row(n, new Date(base)));
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true, horizon: HORIZON }])
      .mockResolvedValueOnce(same);
    await expect(service.sealStream(STREAM)).resolves.toBe(false);
  });

  it('seals every stream until it is caught up, and pauses on a database error', async () => {
    const { prisma, service } = fakePrisma();
    prisma.$queryRaw.mockResolvedValueOnce([STREAM, { appId: APP, category: 'audit' }]);
    const seal = vi
      .spyOn(service, 'sealStream')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await expect(service.sealAll()).resolves.toBe(2);
    expect(seal).toHaveBeenCalledTimes(4);

    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.sealAll()).resolves.toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Sealing paused'));
  });

  it('signs a checkpoint of every stream head, and none before the first seal', async () => {
    const { prisma, service } = fakePrisma();
    await expect(service.checkpoint()).resolves.toBeUndefined();
    const head = { appId: APP, category: 'security', sealNo: 3n, sealHash: sha256('seal 3') };
    prisma.$queryRaw.mockResolvedValueOnce([head]);
    const digest = checkpointDigest({
      [`${APP}:security`]: { sealNo: '3', sealHash: hex(head.sealHash) },
    });
    await expect(service.checkpoint()).resolves.toEqual({ id: 'cp-1', digest: hex(digest) });
    const data = prisma.integrityCheckpoint.create.mock.calls[0]?.[0].data ?? {};
    expect(hex(data.signature as Uint8Array)).toBe(hex(hmac(keys.current.key, digest)));

    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.checkpoint()).rejects.toThrow('connection refused');
  });

  it('reports the age of the oldest unsealed event per application', async () => {
    const { prisma, service } = fakePrisma();
    const now = new Date('2026-10-14T12:00:00.000Z');
    prisma.$queryRaw.mockResolvedValueOnce([
      { slug: 'my-project', oldest: new Date('2026-10-14T11:59:30.000Z') },
      { slug: 'idle', oldest: null },
    ]);
    await service.refreshStats(now);
    expect((service as unknown as { stats: unknown }).stats).toEqual([
      { slug: 'my-project', unsealedAgeSeconds: 30 },
      { slug: 'idle', unsealedAgeSeconds: 0 },
    ]);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('timeout'));
    await service.refreshStats(now);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the sealing state'),
    );
  });

  it('runs on timers while the application is up, and says when the key is the fallback', async () => {
    vi.useFakeTimers();
    const prisma = { $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])) };
    const fallback = integrityKeyring({
      key: undefined,
      previous: undefined,
      fallback: 'f'.repeat(64),
    });
    const service = new SealerService(prisma as unknown as PrismaService, fallback);
    const sealAll = vi.spyOn(service, 'sealAll').mockResolvedValue(0);
    service.onApplicationBootstrap();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('AUDIT_INTEGRITY_KEY is not set'),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sealAll).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sealAll).toHaveBeenCalledTimes(1);
  });
});
