import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { sequenceRanges, SequenceMonitorService } from './sequence-monitor.service.js';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const APP = { appId: 'app-1', slug: 'my-project', keyId: 'k1' };

describe('sequenceRanges', () => {
  it('advances the contiguous prefix and lists what is missing above it', () => {
    expect(sequenceRanges(0n, [1n, 2n, 3n], 3n)).toEqual({ contiguousThrough: 3n, missing: [] });
    expect(sequenceRanges(2n, [3n, 6n, 7n, 10n], 10n)).toEqual({
      contiguousThrough: 3n,
      missing: [
        { from: 4n, to: 5n },
        { from: 8n, to: 9n },
      ],
    });
    expect(sequenceRanges(0n, [5n, 50n], 10n)).toEqual({
      contiguousThrough: 0n,
      missing: [{ from: 1n, to: 4n }],
    });
    expect(sequenceRanges(4n, [], 9n)).toEqual({ contiguousThrough: 4n, missing: [] });
  });
});

function fakePrisma() {
  const tx = {
    $queryRaw: vi.fn(),
    sequenceState: { findUnique: vi.fn(), update: vi.fn(() => Promise.resolve({})) },
    sequenceGap: {
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])),
    $executeRaw: vi.fn(() => Promise.resolve(0)),
    connectorInstance: {
      upsert: vi.fn(() => Promise.resolve({})),
      groupBy: vi.fn(() => Promise.resolve([] as unknown[])),
    },
    sequenceState: { findUnique: vi.fn(() => Promise.resolve(null as unknown)) },
    connectedApp: { findMany: vi.fn(() => Promise.resolve([] as unknown[])) },
    ingestNonce: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  };
  return { prisma, tx, service: new SequenceMonitorService(prisma as unknown as PrismaService) };
}

describe('SequenceMonitorService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a heartbeat and answers the contiguous prefix', async () => {
    const { prisma, service } = fakePrisma();
    prisma.sequenceState.findUnique.mockResolvedValueOnce({ contiguousThrough: 41n });
    const beat = {
      contractVersion: 1,
      connector: { name: 'audit-nestjs', version: '0.1.0' },
      instanceId: 'i1',
      appVersion: '1.0.0',
      catalogVersion: '0123456789abcdef',
      sequenceEpoch: 'e1',
      lastAssignedSeq: 42,
      queue: { size: 1, oldestAgeSeconds: 2, retrying: 0, discardedAtSignOut: 0 },
      responseActions: [],
    };
    await expect(service.heartbeat(APP, beat, NOW)).resolves.toEqual({
      serverTime: NOW.toISOString(),
      contractVersions: [1],
      lastContiguousSeq: 41,
      connectorNotice: null,
    });
    expect(prisma.connectorInstance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { appId_instanceId: { appId: 'app-1', instanceId: 'i1' } },
      }),
    );
    await expect(service.heartbeat(APP, beat, NOW)).resolves.toMatchObject({
      lastContiguousSeq: 0,
    });
  });

  it('opens gaps, keeps their detection time when they shrink and closes them when filled', async () => {
    const { tx, service } = fakePrisma();
    const earlier = new Date(NOW.getTime() - 60_000);
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ seq: 3n }, { seq: 6n }]);
    tx.sequenceState.findUnique.mockResolvedValueOnce({ contiguousThrough: 2n, maxSeen: 6n });
    tx.sequenceGap.findMany.mockResolvedValueOnce([
      { id: 'g1', fromSeq: 4n, toSeq: 5n, detectedAt: earlier },
      { id: 'g2', fromSeq: 8n, toSeq: 9n, detectedAt: earlier },
    ]);
    await service.detectGapsOf('app-1', 'e1', NOW);
    expect(tx.sequenceState.update).toHaveBeenCalledWith({
      where: { appId_epoch: { appId: 'app-1', epoch: 'e1' } },
      data: { contiguousThrough: 3n },
    });
    // g1 unchanged; g2 filled (closed, nothing reopened).
    expect(tx.sequenceGap.update).toHaveBeenCalledTimes(1);
    expect(tx.sequenceGap.update).toHaveBeenCalledWith({
      where: { id: 'g2' },
      data: { closedAt: NOW, closedReason: 'arrived' },
    });
    expect(tx.sequenceGap.create).not.toHaveBeenCalled();

    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ seq: 5n }, { seq: 9n }]);
    tx.sequenceState.findUnique.mockResolvedValueOnce({ contiguousThrough: 3n, maxSeen: 9n });
    tx.sequenceGap.findMany.mockResolvedValueOnce([
      { id: 'g1', fromSeq: 4n, toSeq: 5n, detectedAt: earlier },
    ]);
    await service.detectGapsOf('app-1', 'e1', NOW);
    // g1 shrank to 4: closed and reopened with its first detection time; 6–8 is new.
    expect(tx.sequenceGap.create).toHaveBeenCalledWith({
      data: { appId: 'app-1', epoch: 'e1', fromSeq: 4n, toSeq: 4n, detectedAt: earlier },
    });
    expect(tx.sequenceGap.create).toHaveBeenCalledWith({
      data: { appId: 'app-1', epoch: 'e1', fromSeq: 6n, toSeq: 8n, detectedAt: NOW },
    });
  });

  it('skips a sequence another instance is working on, or one that is gone', async () => {
    const { tx, service } = fakePrisma();
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    await service.detectGapsOf('app-1', 'e1', NOW);
    tx.$queryRaw.mockResolvedValueOnce([{ locked: true }]);
    tx.sequenceState.findUnique.mockResolvedValueOnce(null);
    await service.detectGapsOf('app-1', 'e1', NOW);
    expect(tx.sequenceGap.findMany).not.toHaveBeenCalled();
  });

  it('runs every sequence that needs it, and survives a database failure', async () => {
    const { prisma, service } = fakePrisma();
    const spy = vi.spyOn(service, 'detectGapsOf').mockResolvedValue();
    prisma.$queryRaw.mockResolvedValueOnce([{ appId: 'a', epoch: 'e' }]);
    await service.detectGaps(NOW);
    expect(spy).toHaveBeenCalledWith('a', 'e', NOW);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('down'));
    await expect(service.detectGaps(NOW)).resolves.toBeUndefined();
  });

  it('computes the gauges from heartbeats, live queues and old gaps', async () => {
    const { prisma, service } = fakePrisma();
    prisma.connectedApp.findMany.mockResolvedValueOnce([
      { id: 'a1', slug: 'one' },
      { id: 'a2', slug: 'two' },
    ]);
    prisma.connectorInstance.groupBy
      .mockResolvedValueOnce([
        { appId: 'a1', _max: { lastHeartbeatAt: new Date(NOW.getTime() - 30_000) } },
      ])
      .mockResolvedValueOnce([
        { appId: 'a1', _sum: { queueSize: 7 }, _max: { queueOldestAgeSec: 12 } },
      ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ appId: 'a1', missing: 3n }]);
    await service.refreshStats(NOW);
    const read = (service as unknown as { stats: unknown }).stats;
    expect(read).toEqual([
      {
        slug: 'one',
        heartbeatAgeSeconds: 30,
        queueSize: 7,
        queueOldestAgeSeconds: 12,
        sequenceGapEvents: 3,
      },
      {
        slug: 'two',
        heartbeatAgeSeconds: undefined,
        queueSize: 0,
        queueOldestAgeSeconds: 0,
        sequenceGapEvents: 0,
      },
    ]);
    prisma.connectedApp.findMany.mockRejectedValueOnce(new Error('down'));
    await expect(service.refreshStats(NOW)).resolves.toBeUndefined();
  });

  it('sweeps nonces and silent instances, and survives a failure', async () => {
    const { prisma, service } = fakePrisma();
    await service.sweep(NOW);
    expect(prisma.ingestNonce.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    prisma.ingestNonce.deleteMany.mockRejectedValueOnce(new Error('down'));
    await expect(service.sweep(NOW)).resolves.toBeUndefined();
  });

  it('starts its timers at boot and clears them on shutdown', () => {
    vi.useFakeTimers();
    const { service } = fakePrisma();
    const refresh = vi.spyOn(service, 'refreshStats').mockResolvedValue();
    const gaps = vi.spyOn(service, 'detectGaps').mockResolvedValue();
    const sweep = vi.spyOn(service, 'sweep').mockResolvedValue();
    service.onApplicationBootstrap();
    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).toHaveBeenCalled();
    expect(gaps).toHaveBeenCalled();
    expect(sweep).toHaveBeenCalled();
    service.onModuleDestroy();
    gaps.mockClear();
    vi.advanceTimersByTime(10 * 60_000);
    expect(gaps).not.toHaveBeenCalled();
  });
});
