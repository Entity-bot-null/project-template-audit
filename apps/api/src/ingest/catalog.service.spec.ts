import { BadRequestException, Logger } from '@nestjs/common';
import { catalogVersionOf } from 'audit-contract';
import { sha256Hex } from 'audit-contract/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { testCatalog } from '../../test/ingest.js';
import { CatalogService } from './catalog.service.js';

function setup() {
  const tx = {
    catalogVersion: { create: vi.fn(() => Promise.resolve({ id: 'v1' })) },
    catalogAction: { createMany: vi.fn(() => Promise.resolve({ count: 3 })) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    catalogVersion: {
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
    },
  };
  return { prisma, tx, service: new CatalogService(prisma as unknown as PrismaService) };
}

describe('CatalogService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('publishes a new version with its actions', async () => {
    const { tx, service } = setup();
    const result = await service.publish('app-1', 'key-1', testCatalog());
    expect(result).toEqual({
      version: catalogVersionOf(testCatalog(), sha256Hex),
      status: 'created',
      actions: 3,
    });
    expect(tx.catalogAction.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          action: 'auth.session.signed_in',
          tags: ['auth.sign_in'],
          userVisible: true,
        }),
        expect.objectContaining({
          action: 'account.profile.updated',
          tags: [],
          userVisible: false,
        }),
      ]) as unknown,
    });
  });

  it('answers unchanged for a version it already has', async () => {
    const { prisma, tx, service } = setup();
    prisma.catalogVersion.findUnique.mockResolvedValueOnce({ id: 'v1' });
    await expect(service.publish('app-1', 'key-1', testCatalog())).resolves.toMatchObject({
      status: 'unchanged',
    });
    expect(tx.catalogVersion.create).not.toHaveBeenCalled();
  });

  it('refuses to move an action to a category kept for less time than in any earlier version', async () => {
    const { prisma, service } = setup();
    const next = testCatalog();
    const action = next.actions['auth.session.signed_in'];
    if (action === undefined) throw new Error('fixture');
    action.category = 'system';
    prisma.catalogVersion.findMany.mockResolvedValueOnce([
      { document: { invalid: true } },
      { document: testCatalog() },
    ]);
    await expect(service.publish('app-1', 'key-1', next)).rejects.toThrow(BadRequestException);
  });

  it('resolves a published version once and serves it from memory until it expires', async () => {
    const { prisma, service } = setup();
    prisma.catalogVersion.findUnique.mockResolvedValue({ id: 'v1', document: testCatalog() });
    const first = await service.resolve('app-1', 'abc', 1_000);
    expect(first?.actions.get('auth.session.signed_in')?.category).toBe('security');
    await service.resolve('app-1', 'abc', 2_000);
    expect(prisma.catalogVersion.findUnique).toHaveBeenCalledTimes(1);
    await service.resolve('app-1', 'abc', 1_000 + 3_600_001);
    expect(prisma.catalogVersion.findUnique).toHaveBeenCalledTimes(2);
    prisma.catalogVersion.findUnique.mockResolvedValueOnce(null);
    await expect(service.resolve('app-1', 'missing')).resolves.toBeUndefined();
  });

  it('bounds the memory it keeps', async () => {
    const { prisma, service } = setup();
    prisma.catalogVersion.findUnique.mockResolvedValue({ id: 'v', document: testCatalog() });
    for (let index = 0; index < 501; index += 1) await service.resolve('app-1', String(index));
    expect((service as unknown as { cache: Map<string, unknown> }).cache.size).toBe(500);
  });
});
