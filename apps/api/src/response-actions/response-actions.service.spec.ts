import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import type { ReplyListener, WebhookWorker } from '../webhooks/webhook-worker.service.js';
import type { ClaimedDelivery } from '../webhooks/webhook.store.js';
import { ResponseActionsService } from './response-actions.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const ACTION = '0199e0b1-0000-7000-8000-0000000000c1';
const FIRST = { id: '0199e0b1-0000-7000-8000-00000000000a', role: 'admin' as const };
const SECOND = { id: '0199e0b1-0000-7000-8000-00000000000b', role: 'admin' as const };
const NOW = new Date('2026-10-15T12:00:00.000Z');

const actionRow = (overrides: Record<string, unknown> = {}) => ({
  id: ACTION,
  appId: APP,
  subject: 'user-1',
  action: 'revoke_sessions',
  reason: 'Account taken over by someone',
  status: 'pending_approval',
  alertId: null,
  requestedById: FIRST.id,
  approvedById: null,
  approvedAt: null,
  deliveryId: null,
  resultEventPk: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  completedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const app = (overrides: Record<string, unknown> = {}) => ({
  id: APP,
  status: 'active',
  webhookUrl: 'https://app.example.com/api/audit/webhooks',
  acceptedResponseActions: ['revoke_sessions'],
  requireActionApproval: true,
  ...overrides,
});

function setup() {
  const tx = {
    responseAction: {
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(actionRow({ ...args.data })),
      ),
      update: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(actionRow({ status: 'dispatched', ...args.data })),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(actionRow({ status: 'dispatched' }))),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    connectedApp: { findFirst: vi.fn(() => Promise.resolve(app() as unknown)) },
    catalogVersion: {
      findFirst: vi.fn(() =>
        Promise.resolve({ document: { responseActions: ['revoke_sessions'] } } as unknown),
      ),
    },
    alert: { findUnique: vi.fn(() => Promise.resolve({ appId: APP } as unknown)) },
    responseAction: {
      findUnique: vi.fn(() => Promise.resolve(actionRow() as unknown)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(actionRow({ status: 'cancelled' }))),
      findMany: vi.fn((..._args: unknown[]) => Promise.resolve([actionRow()])),
      count: vi.fn(() => Promise.resolve(1)),
      updateMany: vi.fn((..._args: unknown[]) => Promise.resolve({ count: 1 })),
    },
  };
  const webhooks = { toApp: vi.fn(() => Promise.resolve('delivery-1' as string | undefined)) };
  let reply: ReplyListener | undefined;
  const worker = {
    onReply: vi.fn((_type: string, listener: ReplyListener) => {
      reply = listener;
    }),
  };
  const service = new ResponseActionsService(
    prisma as unknown as PrismaService,
    webhooks as unknown as WebhookOutboxService,
    worker as unknown as WebhookWorker,
  );
  return { tx, prisma, webhooks, worker, service, reply: () => reply };
}

const request = {
  appId: APP,
  subject: 'user-1',
  action: 'revoke_sessions' as const,
  reason: 'Account taken over by someone',
};

describe('ResponseActionsService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request', () => {
    it('waits for a second administrator when the application requires it', async () => {
      const { tx, webhooks, service } = setup();
      await expect(service.request(FIRST, request)).resolves.toMatchObject({
        status: 'pending_approval',
        requestedById: FIRST.id,
      });
      expect(tx.responseAction.create.mock.calls[0]?.[0].data).toMatchObject({
        status: 'pending_approval',
      });
      expect(webhooks.toApp).not.toHaveBeenCalled();
    });

    it('goes to the application at once otherwise, as a signed webhook', async () => {
      const { tx, prisma, webhooks, service } = setup();
      prisma.connectedApp.findFirst.mockResolvedValueOnce(app({ requireActionApproval: false }));
      await expect(
        service.request(FIRST, { ...request, alertId: '0199e0b1-0000-7000-8000-0000000000a1' }),
      ).resolves.toMatchObject({
        status: 'dispatched',
      });
      expect(webhooks.toApp).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: APP,
          type: 'response_action.requested',
          data: expect.objectContaining({
            action: 'revoke_sessions',
            subject: 'user-1',
          }) as unknown,
        }),
        tx,
      );
      expect(tx.responseAction.update).toHaveBeenCalledWith({
        where: { id: ACTION },
        data: { deliveryId: 'delivery-1' },
      });
    });

    it('refuses what the application does not accept, declare or can receive', async () => {
      const { prisma, webhooks, service } = setup();
      prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
      await expect(service.request(FIRST, request)).rejects.toBeInstanceOf(NotFoundException);
      prisma.connectedApp.findFirst.mockResolvedValueOnce(app({ acceptedResponseActions: [] }));
      await expect(service.request(FIRST, request)).rejects.toThrow(/not accepted/);
      prisma.catalogVersion.findFirst.mockResolvedValueOnce({ document: {} });
      await expect(service.request(FIRST, request)).rejects.toThrow(/not declared/);
      prisma.catalogVersion.findFirst.mockResolvedValueOnce(null);
      await expect(service.request(FIRST, request)).rejects.toThrow(/not declared/);
      prisma.connectedApp.findFirst.mockResolvedValueOnce(app({ webhookUrl: null }));
      await expect(service.request(FIRST, request)).rejects.toThrow(/no webhook URL/);
      prisma.alert.findUnique.mockResolvedValueOnce({ appId: 'another' });
      await expect(
        service.request(FIRST, { ...request, alertId: '0199e0b1-0000-7000-8000-0000000000a1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      prisma.connectedApp.findFirst.mockResolvedValueOnce(app({ requireActionApproval: false }));
      webhooks.toApp.mockResolvedValueOnce(undefined);
      await expect(service.request(FIRST, request)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('approve and cancel', () => {
    it('lets someone other than the requester approve once', async () => {
      const { tx, prisma, service } = setup();
      await expect(service.approve(FIRST, ACTION)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.approve(SECOND, ACTION)).resolves.toMatchObject({
        status: 'dispatched',
      });
      expect(tx.responseAction.updateMany.mock.calls[0]).toEqual([
        {
          where: { id: ACTION, status: 'pending_approval' },
          data: expect.objectContaining({
            approvedById: SECOND.id,
            status: 'dispatched',
          }) as unknown,
        },
      ]);
      prisma.responseAction.findUnique.mockResolvedValueOnce(actionRow({ status: 'dispatched' }));
      await expect(service.approve(SECOND, ACTION)).rejects.toThrow(/dispatched, not waiting/);
      prisma.responseAction.findUnique.mockResolvedValueOnce(actionRow({ expiresAt: new Date(0) }));
      await expect(service.approve(SECOND, ACTION)).rejects.toBeInstanceOf(ConflictException);
      tx.responseAction.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.approve(SECOND, ACTION)).rejects.toThrow(/changed since/);
      prisma.responseAction.findUnique.mockResolvedValueOnce(null);
      await expect(service.approve(SECOND, ACTION)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancels a request waiting for approval, and only those', async () => {
      const { prisma, service } = setup();
      await expect(service.cancel(SECOND, ACTION)).resolves.toMatchObject({ status: 'cancelled' });
      prisma.responseAction.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.responseAction.findUnique.mockResolvedValueOnce({ status: 'dispatched' });
      await expect(service.cancel(SECOND, ACTION)).rejects.toThrow(/dispatched: it can no longer/);
      prisma.responseAction.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.responseAction.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancel(SECOND, ACTION)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('outcomes', () => {
    it('settles a dispatched request from the application event, once', async () => {
      const { tx, service } = setup();
      await expect(
        service.settle(tx as never, APP, { actionId: ACTION, result: 'succeeded' }, 'event-pk'),
      ).resolves.toBe(true);
      expect(tx.responseAction.updateMany).toHaveBeenCalledWith({
        where: { id: ACTION, appId: APP, status: 'dispatched' },
        data: expect.objectContaining({
          status: 'succeeded',
          resultEventPk: 'event-pk',
        }) as unknown,
      });
      tx.responseAction.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.settle(tx as never, APP, { actionId: ACTION, result: 'failed' }, 'event-pk'),
      ).resolves.toBe(false);
    });

    it("settles at once on the application's refusal; an acceptance waits for its event", async () => {
      const { prisma, worker, service, reply } = setup();
      service.onApplicationBootstrap();
      expect(worker.onReply).toHaveBeenCalledWith(
        'response_action.requested',
        expect.any(Function),
      );
      const delivery = { id: 'delivery-1' } as ClaimedDelivery;
      await reply()?.(delivery, 'accepted');
      expect(prisma.responseAction.updateMany).not.toHaveBeenCalled();
      await reply()?.(delivery, 'unsupported');
      expect(prisma.responseAction.updateMany).toHaveBeenCalledWith({
        where: { deliveryId: 'delivery-1', status: 'dispatched' },
        data: expect.objectContaining({ status: 'unsupported' }) as unknown,
      });
      prisma.responseAction.updateMany.mockResolvedValueOnce({ count: 0 });
      await reply()?.(delivery, 'refused');
      service.onModuleDestroy();
    });

    it('expires what nobody approved or answered, on a timer', async () => {
      vi.useFakeTimers();
      const { prisma, service } = setup();
      service.onApplicationBootstrap();
      prisma.responseAction.updateMany.mockResolvedValueOnce({ count: 2 });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(prisma.responseAction.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: { status: { in: ['pending_approval', 'dispatched'] } },
        data: { status: 'expired' },
      });
      prisma.responseAction.updateMany.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.sweep()).resolves.toBe(0);
      service.onModuleDestroy();
    });
  });

  it('lists and reads requests', async () => {
    const { prisma, service } = setup();
    await expect(
      service.list({ appId: APP, status: 'pending_approval', limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: ACTION }],
    });
    expect(prisma.responseAction.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { appId: APP, status: 'pending_approval' },
    });
    await expect(service.get(ACTION)).resolves.toMatchObject({ id: ACTION });
    prisma.responseAction.findUnique.mockResolvedValueOnce(null);
    await expect(service.get(ACTION)).rejects.toBeInstanceOf(NotFoundException);
  });
});
