import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStore } from './webhook.store.js';

function setup() {
  const prisma = {
    $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])),
    webhookDelivery: {
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
      ),
      deleteMany: vi.fn((_args: { where: Record<string, unknown> }) =>
        Promise.resolve({ count: 2 }),
      ),
      aggregate: vi.fn(() =>
        Promise.resolve({ _count: { _all: 0 }, _min: { createdAt: null as Date | null } }),
      ),
    },
  };
  return { prisma, store: new WebhookStore(prisma as unknown as PrismaService) };
}

const claim = { id: 'd1', attempts: 2 };

describe('WebhookStore', () => {
  it('claims the next due delivery, or none', async () => {
    const { prisma, store } = setup();
    await expect(store.claim()).resolves.toBeUndefined();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'd1' }]);
    await expect(store.claim()).resolves.toEqual({ id: 'd1' });
  });

  it('fences every outcome by the claim it was made under', async () => {
    const { prisma, store } = setup();
    await expect(store.markDelivered(claim, 200)).resolves.toBe(true);
    await store.reschedule(claim, 30_000, 503, 'http_503');
    await store.markFailed(claim, 401, 'unauthorized');
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(store.markExpired(claim, 'expired')).resolves.toBe(false);
    const calls = prisma.webhookDelivery.updateMany.mock.calls.map(([args]) => args);
    for (const args of calls) {
      expect(args.where).toEqual({ id: 'd1', status: 'sending', attempts: 2 });
    }
    expect(calls.map((args) => args.data.status)).toEqual([
      'delivered',
      'pending',
      'failed',
      'expired',
    ]);
    expect(calls[1]?.data).toMatchObject({ lastStatus: 503, lastError: 'http_503' });
  });

  it('reports the queue, and sweeps old deliveries', async () => {
    const { prisma, store } = setup();
    await expect(store.stats()).resolves.toEqual({ waiting: 0, oldestAgeSeconds: 0 });
    prisma.webhookDelivery.aggregate.mockResolvedValueOnce({
      _count: { _all: 3 },
      _min: { createdAt: new Date(Date.now() - 60_000) },
    });
    const stats = await store.stats();
    expect(stats.waiting).toBe(3);
    expect(stats.oldestAgeSeconds).toBeGreaterThanOrEqual(59);
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 4 });
    await expect(store.sweep(Date.parse('2026-10-15T00:00:00.000Z'))).resolves.toEqual({
      deleted: 2,
      expired: 4,
    });
    expect(prisma.webhookDelivery.deleteMany.mock.calls[0]?.[0].where).toEqual({
      status: { in: ['delivered', 'expired', 'failed'] },
      createdAt: { lt: new Date('2026-09-15T00:00:00.000Z') },
    });
  });
});
