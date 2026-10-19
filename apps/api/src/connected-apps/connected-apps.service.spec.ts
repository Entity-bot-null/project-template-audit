import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretBox, secretBoxFromConfig } from '../common/crypto/secret-box.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  ConnectedAppsService,
  contexts,
  KEY_GRACE_MS,
  SYSTEM_APP_ID,
} from './connected-apps.service.js';

// The SQL (locks, unique slugs) runs in ingest.int.spec.ts; here, how
// secrets are generated, sealed and handed out.

const NOW = new Date('2026-10-14T12:00:00.000Z');
const box: SecretBox = secretBoxFromConfig({
  secret: 's'.repeat(64),
  previous: undefined,
  fallback: 'j'.repeat(64),
}).box;

const ROW = {
  id: 'app-1',
  slug: 'my-project',
  name: 'My project',
  environment: 'production',
  status: 'active' as const,
  webhookUrl: 'https://app.example.com/api/audit/webhooks',
  correlationEnabled: false,
  acceptedResponseActions: [],
  requireActionApproval: true,
  heartbeatTimeoutSec: 300,
  rateLimitPerMinute: 120,
  createdAt: NOW,
  keys: [{ id: 'k1', createdAt: NOW, expiresAt: null, revokedAt: null, lastUsedAt: null }],
};
/** What deleteLog reads of a suspended application. */
const SUSPENDED = { slug: 'my-project', status: 'suspended' };

function setup() {
  const tx = {
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ webhookSecret: null }] as unknown[]),
    ),
    connectedApp: {
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      create: vi.fn(() => Promise.resolve({ id: 'app-1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    appKey: {
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      create: vi.fn(() => Promise.resolve({ id: 'k2' })),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
  const prisma = {
    // audit_delete_events: one batch, nothing deleted, held or waiting by default.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ deleted: 0, held: 0, unsealed: 0 }] as unknown[]),
    ),
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    connectedApp: {
      findMany: vi.fn(() => Promise.resolve([ROW])),
      findFirst: vi.fn(() => Promise.resolve(ROW as unknown)),
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    appKey: {
      findFirst: vi.fn(() => Promise.resolve(null as unknown)),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    legalHold: { count: vi.fn((_args: unknown) => Promise.resolve(0)) },
    retentionRun: {
      aggregate: vi.fn((_args: unknown): Promise<{ _sum: { deletedCount: number | null } }> =>
        Promise.resolve({ _sum: { deletedCount: 5003 } }),
      ),
    },
  };
  return { prisma, tx, service: new ConnectedAppsService(prisma as unknown as PrismaService, box) };
}

describe('ConnectedAppsService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('registers an application and hands out its secrets once, sealed in storage', async () => {
    const { tx, service } = setup();
    const created = await service.create('admin-1', {
      slug: 'my-project',
      name: 'My project',
      environment: 'production',
    });
    const variables = created.credentials.variables;
    expect(Object.keys(variables).sort()).toEqual([
      'AUDIT_HUB_APP',
      'AUDIT_HUB_KEY_ID',
      'AUDIT_HUB_KEY_SECRET',
      'AUDIT_HUB_PSEUDONYM_KEY',
      'AUDIT_HUB_URL',
      'AUDIT_HUB_WEBHOOK_SECRET',
    ]);
    expect(variables.AUDIT_HUB_KEY_ID).toBe('k2');
    const sealedKey = (
      tx.appKey.update.mock.calls[0] as unknown as [{ data: { secret: Uint8Array } }]
    )[0].data.secret;
    expect(box.open(sealedKey, contexts.key('k2')).toString('base64url')).toBe(
      variables.AUDIT_HUB_KEY_SECRET,
    );
    const sealedPseudonym = (
      tx.connectedApp.update.mock.calls[0] as unknown as [{ data: { pseudonymKey: Uint8Array } }]
    )[0].data.pseudonymKey;
    expect(box.open(sealedPseudonym, contexts.pseudonym('app-1')).toString('base64url')).toBe(
      variables.AUDIT_HUB_PSEUDONYM_KEY,
    );
    expect(created.app).toMatchObject({
      slug: 'my-project',
      keys: [{ id: 'k1', expiresAt: null }],
    });
  });

  it('refuses a taken slug', async () => {
    const { tx, service } = setup();
    tx.connectedApp.findUnique.mockResolvedValueOnce({ id: 'other' });
    await expect(
      service.create('admin-1', { slug: 'my-project', name: 'x', environment: 'production' }),
    ).rejects.toThrow(ConflictException);
  });

  it('lists, reads and changes applications, never the system one', async () => {
    const { prisma, service } = setup();
    await expect(service.list()).resolves.toHaveLength(1);
    expect(prisma.connectedApp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { system: false } }),
    );
    await expect(service.update('app-1', { name: 'New' })).resolves.toMatchObject({ id: 'app-1' });
    // Nothing changed and no such application (or the system one): 404.
    prisma.connectedApp.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
    await expect(service.update('app-1', { name: 'New' })).rejects.toThrow(NotFoundException);
    prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('app-1')).rejects.toThrow(NotFoundException);
  });

  it('changes no retired application: its log was deleted (409)', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.connectedApp.findFirst.mockResolvedValueOnce({ ...ROW, status: 'retired' });
    await expect(service.update('app-1', { status: 'active' })).rejects.toThrow(
      new ConflictException('The application is retired: its log was deleted'),
    );
    expect(prisma.connectedApp.updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', system: false, status: { not: 'retired' } },
      data: { status: 'active' },
    });
  });

  it("deletes a log only with the application's slug typed again (400), deleting nothing", async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    await expect(service.deleteLog('app-1', 'my-projec')).rejects.toThrow(BadRequestException);
    expect(prisma.connectedApp.findFirst).toHaveBeenCalledWith({
      where: { id: 'app-1', system: false },
      select: { slug: true, status: true },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('deletes the log of a suspended application only (409), and of no unknown one (404)', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce({ slug: 'my-project', status: 'active' });
    await expect(service.deleteLog('app-1', 'my-project')).rejects.toThrow(ConflictException);
    prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
    await expect(service.deleteLog('app-1', 'my-project')).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('answers a retired application as deleted, deleting nothing again', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce({ slug: 'my-project', status: 'retired' });
    await expect(service.deleteLog('app-1', 'anything')).resolves.toEqual({
      progress: { status: 'deleted', deleted: 0, held: 0, waiting: 0 },
      retired: false,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('says deleting when its time is up while batches still come back full: call again', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    prisma.$queryRaw.mockResolvedValue([{ deleted: 5000, held: 0, unsealed: 0 }]);
    await expect(service.deleteLog('app-1', 'my-project', 0)).resolves.toEqual({
      progress: { status: 'deleting', deleted: 5000, held: 0, waiting: 0 },
      retired: false,
    });
    // One batch at least, whatever the budget: every event of the application, 5000 at a time.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]!;
    expect(strings.join('?')).toContain('audit_delete_events(');
    expect(values).toEqual(['app-1', 5000]);
    expect(prisma.legalHold.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('says deleting, finishing nothing, while another deletion of its events holds the lock', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ deleted: 5000, held: 0, unsealed: 0 }])
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Raw query failed', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { driverAdapterError: { cause: { kind: 'postgres', code: '55P03' } } },
        }),
      );
    await expect(service.deleteLog('app-1', 'my-project')).resolves.toEqual({
      progress: { status: 'deleting', deleted: 5000, held: 0, waiting: 0 },
      retired: false,
    });
    expect(prisma.legalHold.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Any other failure is passed on.
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database down'));
    await expect(service.deleteLog('app-1', 'my-project')).rejects.toThrow('database down');
  });

  it('says held while a legal hold keeps events, and waiting while events wait for their seal', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValue(SUSPENDED);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ deleted: 12, held: 3, unsealed: 4 }])
      .mockResolvedValueOnce([{ deleted: 0, held: 0, unsealed: 4 }]);
    await expect(service.deleteLog('app-1', 'my-project')).resolves.toEqual({
      progress: { status: 'held', deleted: 12, held: 3, waiting: 4 },
      retired: false,
    });
    await expect(service.deleteLog('app-1', 'my-project')).resolves.toEqual({
      progress: { status: 'waiting', deleted: 0, held: 0, waiting: 4 },
      retired: false,
    });
    expect(prisma.legalHold.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('says held while an active legal hold names the application, its events all gone', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    // No row at all: nothing deleted, held or waiting.
    prisma.$queryRaw.mockResolvedValueOnce([]);
    prisma.legalHold.count.mockResolvedValueOnce(1);
    await expect(service.deleteLog('app-1', 'my-project')).resolves.toEqual({
      progress: { status: 'held', deleted: 0, held: 0, waiting: 0 },
      retired: false,
    });
    // Only the holds not released yet.
    expect(prisma.legalHold.count).toHaveBeenCalledWith({
      where: { appId: 'app-1', release: { is: null } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retires the application once nothing is left, in one transaction: secrets gone, a new pseudonymization key', async () => {
    const { prisma, tx, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(SUSPENDED);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ deleted: 5000, held: 0, unsealed: 0 }])
      .mockResolvedValueOnce([{ deleted: 3, held: 0, unsealed: 0 }]);
    await expect(service.deleteLog('app-1', 'my-project')).resolves.toEqual({
      progress: { status: 'deleted', deleted: 5003, held: 0, waiting: 0 },
      retired: true,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // What Audit Hub derived from the log first, then the application itself.
    const [strings, ...values] = tx.$queryRaw.mock.calls[0]!;
    expect(strings.join('?')).toContain('audit_finish_application_deletion(');
    expect(values).toEqual(['app-1']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.connectedApp.update.mock.invocationCallOrder[0]!,
    );
    const update = (
      tx.connectedApp.update.mock.calls[0] as unknown as [
        { where: unknown; data: { pseudonymKey: Uint8Array } & Record<string, unknown> },
      ]
    )[0];
    expect(update.where).toEqual({ id: 'app-1' });
    const { pseudonymKey, ...data } = update.data;
    expect(data).toEqual({
      status: 'retired',
      webhookUrl: null,
      webhookSecret: null,
      webhookSecretPrevious: null,
      webhookPreviousUntil: null,
    });
    // Replaced by a key nobody was given: 32 random bytes, sealed for the row.
    expect(box.open(pseudonymKey, contexts.pseudonym('app-1'))).toHaveLength(32);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Connected application my-project (app-1) retired: its audit log was deleted',
    );
  });

  it('sums the events the end of service deleted, over its runs', async () => {
    const { prisma, service } = setup();
    await expect(service.deletedEvents('app-1')).resolves.toBe(5003);
    expect(prisma.retentionRun.aggregate).toHaveBeenCalledWith({
      where: { appId: 'app-1', trigger: 'decommission' },
      _sum: { deletedCount: true },
    });
    prisma.retentionRun.aggregate.mockResolvedValueOnce({ _sum: { deletedCount: null } });
    await expect(service.deletedEvents('app-1')).resolves.toBe(0);
  });

  it('rotates a key with a grace period, and refuses a third valid one', async () => {
    const { tx, service } = setup();
    tx.appKey.findMany.mockResolvedValueOnce([{ id: 'k1', expiresAt: null }]);
    await service.createKey('admin-1', 'app-1');
    const grace = (
      tx.appKey.updateMany.mock.calls[0] as unknown as [{ data: { expiresAt: Date } }]
    )[0].data.expiresAt;
    expect(grace.getTime()).toBeGreaterThan(Date.now() + KEY_GRACE_MS - 5_000);
    tx.appKey.findMany.mockResolvedValueOnce([
      { id: 'k1', expiresAt: NOW },
      { id: 'k2', expiresAt: null },
    ]);
    await expect(service.createKey('admin-1', 'app-1')).rejects.toThrow(ConflictException);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.createKey('admin-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('revokes a key, and says when there is none', async () => {
    const { prisma, service } = setup();
    await expect(service.revokeKey('app-1', 'k1')).resolves.toBeUndefined();
    prisma.appKey.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.revokeKey('app-1', 'k1')).rejects.toThrow(NotFoundException);
  });

  it('rotates the webhook secret keeping the previous one for its grace period', async () => {
    const { tx, service } = setup();
    const previous = box.seal(Buffer.from('old'), contexts.webhook('app-1')).ciphertext;
    tx.$queryRaw.mockResolvedValueOnce([{ webhookSecret: previous }]);
    const rotated = await service.rotateWebhookSecret('app-1');
    const data = (
      tx.connectedApp.update.mock.calls[0] as unknown as [
        { data: { webhookSecret: Uint8Array; webhookSecretPrevious: Uint8Array } },
      ]
    )[0].data;
    expect(box.open(data.webhookSecret, contexts.webhook('app-1')).toString('base64url')).toBe(
      rotated.variables.AUDIT_HUB_WEBHOOK_SECRET,
    );
    expect(box.open(data.webhookSecretPrevious, contexts.webhookPrevious('app-1')).toString()).toBe(
      'old',
    );
  });

  it('gives the signature guard the key, and records its use at most once a minute', async () => {
    const { prisma, service } = setup();
    await expect(service.verificationKey('k1', NOW)).resolves.toBeUndefined();
    const secret = box.seal(Buffer.alloc(32, 7), contexts.key('k1')).ciphertext;
    const app = { id: 'app-1', slug: 'my-project', status: 'active', rateLimitPerMinute: 120 };
    prisma.appKey.findFirst.mockResolvedValueOnce({ secret, lastUsedAt: null, app });
    const key = await service.verificationKey('k1', NOW);
    expect(key?.key.equals(Buffer.alloc(32, 7))).toBe(true);
    expect(prisma.appKey.update).toHaveBeenCalledTimes(1);
    prisma.appKey.findFirst.mockResolvedValueOnce({ secret, lastUsedAt: NOW, app });
    await service.verificationKey('k1', NOW);
    expect(prisma.appKey.update).toHaveBeenCalledTimes(1);
  });

  it('opens the webhook keys, the previous one only during its grace period', async () => {
    const { prisma, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
    await expect(service.webhookTarget('app-1', NOW)).resolves.toBeUndefined();
    const current = box.seal(Buffer.from('new'), contexts.webhook('app-1')).ciphertext;
    const previous = box.seal(Buffer.from('old'), contexts.webhookPrevious('app-1')).ciphertext;
    const row = {
      slug: 'my-project',
      webhookUrl: 'https://x/api/audit/webhooks',
      webhookSecret: current,
      webhookSecretPrevious: previous,
      webhookPreviousUntil: new Date(NOW.getTime() + 1000),
    };
    prisma.connectedApp.findFirst.mockResolvedValueOnce(row);
    expect((await service.webhookTarget('app-1', NOW))?.keys.map(String)).toEqual(['new', 'old']);
    prisma.connectedApp.findFirst.mockResolvedValueOnce({ ...row, webhookPreviousUntil: NOW });
    expect((await service.webhookTarget('app-1', NOW))?.keys.map(String)).toEqual(['new']);
  });

  it('opens the pseudonymization key and keeps the system application ready', async () => {
    const { prisma, service } = setup();
    await expect(service.pseudonymKey('app-1')).rejects.toThrow(NotFoundException);
    const sealed = box.seal(Buffer.alloc(32, 3), contexts.pseudonym('app-1')).ciphertext;
    prisma.connectedApp.findUnique.mockResolvedValueOnce({ pseudonymKey: sealed });
    await expect(service.pseudonymKey('app-1')).resolves.toEqual(Buffer.alloc(32, 3));

    await service.ensureSystemApp();
    expect(prisma.connectedApp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SYSTEM_APP_ID } }),
    );
    prisma.connectedApp.findUnique.mockResolvedValueOnce({ pseudonymKey: sealed });
    await service.ensureSystemApp();
    expect(prisma.connectedApp.upsert).toHaveBeenCalledTimes(1);
  });
});
