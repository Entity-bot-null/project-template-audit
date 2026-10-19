import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessService } from '../access/app-access.service.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import type { ExplorerService } from '../explorer/explorer.service.js';
import type { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import { AlertsService, type RaiseAlert } from './alerts.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const ALERT = '0199e0b1-0000-7000-8000-0000000000a1';
const AUDITOR = { id: '0199e0b1-0000-7000-8000-00000000000b', role: 'auditor' as const };
const AT = new Date('2026-10-15T12:00:00.000Z');
const STAFF = '0199e0b1-0000-7000-8000-0000000000c1';

/** An event behind an alert, as its detail selects it (EVIDENCE_SELECT). */
const eventRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  eventId: `x-${id}`,
  appId: APP,
  recordedAt: AT,
  occurredAt: AT,
  category: 'security',
  catalogVersionId: null,
  action: 'user.sign_in',
  outcome: 'failure',
  severity: 'medium',
  riskScore: 40,
  actorType: 'user',
  actorId: 'user-9',
  actorRole: 'member',
  resourceType: null,
  resourceId: null,
  requestId: null,
  httpStatus: null,
  clientType: 'web',
  geoCountry: 'MX',
  ipScope: 'public',
  reason: 'invalid_credentials',
  actorEmailHmac: null,
  uaBrowser: 'Microsoft Edge',
  uaOs: 'Linux',
  clientDeviceModel: null,
  app: { slug: 'my-project' },
  personal: { actorLabel: 'Ada Lovelace', resourceLabel: null } as {
    actorLabel: string | null;
    resourceLabel: string | null;
  } | null,
  ...overrides,
});

const alertRow = (overrides: Record<string, unknown> = {}) => ({
  id: ALERT,
  appId: APP,
  app: { slug: 'my-project' },
  rule: 'brute_force_account',
  severity: 'high',
  status: 'open',
  subject: 'user-9',
  title: '10 failed sign-ins of one account in 15 minutes',
  summary: { failures: 10 },
  occurrences: 1,
  firstSeenAt: AT,
  lastSeenAt: AT,
  assigneeId: null,
  resolvedAt: null,
  resolvedById: null,
  version: 0,
  activities: [],
  events: [] as { eventPk: string }[],
  ...overrides,
});

function setup() {
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: ALERT, created: true }] as unknown[])),
    $executeRaw: vi.fn(() => Promise.resolve(1)),
    alertActivity: {
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    },
    connectedApp: {
      findUniqueOrThrow: vi.fn(() =>
        Promise.resolve({ slug: 'my-project', name: 'My project', system: false }),
      ),
    },
    auditEvent: { findFirst: vi.fn(() => Promise.resolve({ eventId: 'e-1' } as unknown)) },
    user: {
      findMany: vi.fn(() =>
        Promise.resolve([{ id: 'admin-1', email: 'admin@example.com' }] as unknown[]),
      ),
    },
    alert: { updateMany: vi.fn((..._args: unknown[]) => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    $queryRaw: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown[])),
    auditEvent: { findMany: vi.fn((_args: unknown) => Promise.resolve([] as unknown[])) },
    alert: {
      findMany: vi.fn(() => Promise.resolve([alertRow()] as unknown[])),
      count: vi.fn(() => Promise.resolve(1)),
      findUnique: vi.fn(() => Promise.resolve(alertRow() as unknown)),
      groupBy: vi.fn(() =>
        Promise.resolve([{ severity: 'high', _count: { _all: 2 } }] as unknown[]),
      ),
    },
    alertActivity: { create: vi.fn(() => Promise.resolve({})) },
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: AUDITOR.id, role: 'auditor', disabledAt: null } as unknown),
      ),
      findMany: vi.fn((_args: unknown) => Promise.resolve([] as unknown[])),
    },
  };
  const access = {
    appFilter: vi.fn(() => Promise.resolve({})),
    canSee: vi.fn(() => Promise.resolve(true)),
    canManage: vi.fn(() => Promise.resolve(true)),
  };
  const webhooks = {
    toApp: vi.fn((..._args: unknown[]) => Promise.resolve('delivery-1' as string | undefined)),
    toChat: vi.fn((..._args: unknown[]) => Promise.resolve('chat-1')),
    chatTargets: [] as ('slack' | 'teams')[],
  };
  const mail = { enabled: true, enqueue: vi.fn(() => Promise.resolve('queued')) };
  // The explorer's summaries, as it would answer them: the label sent, else nothing.
  const explorer = {
    summaries: vi.fn((rows: ReturnType<typeof eventRow>[]) =>
      Promise.resolve(
        rows.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          action: row.action,
          description: row.action === 'user.sign_in' ? 'Signed in.' : null,
          outcome: row.outcome,
          recordedAt: row.recordedAt.toISOString(),
          actor: {
            type: row.actorType,
            id: row.actorId,
            role: row.actorRole,
            label: row.personal?.actorLabel ?? null,
          },
        })),
      ),
    ),
  };
  const service = new AlertsService(
    prisma as unknown as PrismaService,
    access as unknown as AppAccessService,
    webhooks as unknown as WebhookOutboxService,
    mail as unknown as MailOutboxService,
    explorer as unknown as ExplorerService,
  );
  return { tx, prisma, access, webhooks, mail, explorer, service };
}

const raise = (overrides: Partial<RaiseAlert> = {}): RaiseAlert => ({
  appId: APP,
  rule: 'brute_force_account',
  severity: 'high',
  groupKey: `brute_force_account:${APP}:user-9`,
  subject: 'user-9',
  title: '10 failed sign-ins of one account in 15 minutes',
  summary: { failures: 10 },
  eventPks: ['0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70'],
  at: AT,
  ...overrides,
});

describe('AlertsService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('raise', () => {
    it('creates an alert and notifies the application, the chat channels and by email', async () => {
      const { tx, webhooks, mail, service } = setup();
      webhooks.chatTargets = ['slack', 'teams'];
      await expect(service.raise(tx as never, raise())).resolves.toEqual({
        id: ALERT,
        created: true,
      });
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(webhooks.toApp).toHaveBeenCalledWith(
        {
          appId: APP,
          type: 'alert.created',
          data: {
            alertId: ALERT,
            rule: 'brute_force_account',
            severity: 'high',
            subject: 'user-9',
            summary: raise().title,
            firstEventId: 'e-1',
          },
        },
        tx,
      );
      expect(webhooks.toChat.mock.calls.map(([target]) => target)).toEqual(['slack', 'teams']);
      expect(mail.enqueue).toHaveBeenCalledWith(tx, {
        kind: 'security_alert',
        to: 'admin@example.com',
        userId: 'admin-1',
        payload: { alertId: ALERT },
        dedupeKey: `security_alert:${ALERT}:admin-1`,
      });
      // Administrators, and auditors of the application, whose account may sign in.
      expect(tx.user.findMany).toHaveBeenCalledWith({
        where: {
          disabledAt: null,
          OR: [{ role: 'admin' }, { role: 'auditor', appAssignments: { some: { appId: APP } } }],
        },
        select: { id: true, email: true },
      });
      const kinds = tx.alertActivity.create.mock.calls.map(([args]) => args.data);
      expect(kinds).toEqual([
        { alertId: ALERT, kind: 'created' },
        { alertId: ALERT, kind: 'notified', note: 'webhook, slack, teams, email' },
      ]);
    });

    it('adds an occurrence to the open alert of its group, notifying nobody again', async () => {
      const { tx, webhooks, mail, service } = setup();
      tx.$queryRaw.mockResolvedValueOnce([{ id: ALERT, created: false }]);
      await service.raise(tx as never, raise({ eventPks: [] }));
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.alertActivity.create).not.toHaveBeenCalled();
      expect(webhooks.toApp).not.toHaveBeenCalled();
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('notifies by severity: chat from medium, email from high, the application always', async () => {
      const { tx, webhooks, mail, service } = setup();
      webhooks.chatTargets = ['slack'];
      await service.raise(tx as never, raise({ severity: 'low', subject: undefined }));
      expect(webhooks.toChat).not.toHaveBeenCalled();
      expect(mail.enqueue).not.toHaveBeenCalled();
      expect(webhooks.toApp.mock.calls[0]?.[0]).not.toHaveProperty('data.subject');
      await service.raise(tx as never, raise({ severity: 'medium' }));
      expect(webhooks.toChat).toHaveBeenCalledTimes(1);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it("skips what does not apply: no webhook URL, no events, Audit Hub's own application, no email", async () => {
      const { tx, webhooks, mail, service } = setup();
      webhooks.toApp.mockResolvedValueOnce(undefined);
      tx.user.findMany.mockResolvedValueOnce([]);
      await service.raise(tx as never, raise());
      expect(tx.alertActivity.create).toHaveBeenCalledTimes(1);
      tx.auditEvent.findFirst.mockResolvedValueOnce(null);
      mail.enabled = false;
      await service.raise(tx as never, raise());
      tx.connectedApp.findUniqueOrThrow.mockResolvedValueOnce({
        slug: 'audit-hub',
        name: 'Audit Hub',
        system: true,
      });
      await service.raise(tx as never, raise());
      expect(webhooks.toApp).toHaveBeenCalledTimes(1);
      expect(mail.enqueue).not.toHaveBeenCalled();
    });

    it('fails loudly if the statement answered nothing', async () => {
      const { tx, service } = setup();
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.raise(tx as never, raise())).rejects.toThrow(
        /neither created nor updated/,
      );
    });
  });

  describe('reading', () => {
    it("lists the caller's applications' alerts with the filters asked", async () => {
      const { prisma, access, service } = setup();
      access.appFilter.mockResolvedValueOnce({ appId: { in: [APP] } });
      const page = await service.list(AUDITOR, {
        status: ['open'],
        severity: ['high'],
        rule: 'brute_force_account',
        assigneeId: AUDITOR.id,
        limit: 20,
        offset: 0,
      });
      expect(page).toMatchObject({
        total: 1,
        items: [{ id: ALERT, appSlug: 'my-project', version: 0 }],
      });
      expect(prisma.alert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            appId: { in: [APP] },
            status: { in: ['open'] },
            severity: { in: ['high'] },
            rule: 'brute_force_account',
            assigneeId: AUDITOR.id,
          },
        }),
      );
      access.canSee.mockResolvedValueOnce(false);
      await expect(service.list(AUDITOR, { appId: APP, limit: 20, offset: 0 })).resolves.toEqual({
        items: [],
        total: 0,
      });
    });

    it('names the people alerts are about: their latest label, or the name of a staff account', async () => {
      const { prisma, service } = setup();
      prisma.alert.findMany.mockResolvedValueOnce([
        alertRow(),
        alertRow({ id: 'a-2', subject: null }),
        alertRow({ id: 'a-3', appId: SYSTEM_APP_ID, subject: STAFF }),
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([{ alertId: ALERT, label: 'Ada Lovelace' }]);
      prisma.user.findMany.mockResolvedValueOnce([{ id: STAFF, name: 'Grace Hopper' }]);
      const page = await service.list(AUDITOR, { limit: 20, offset: 0 });
      expect(page.items.map((item) => item.subjectLabel)).toEqual([
        'Ada Lovelace',
        null,
        'Grace Hopper',
      ]);
      // One query for the page, only for the applications' alerts with a subject.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.calls[0]).toContainEqual([ALERT]);

      prisma.alert.findMany.mockResolvedValueOnce([alertRow({ subject: null })]);
      await service.list(AUDITOR, { limit: 20, offset: 0 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('explains an alert, counts what its events have in common and names who works on it', async () => {
      const { prisma, explorer, service } = setup();
      prisma.alert.findUnique.mockResolvedValueOnce(
        alertRow({
          summary: { failures: 12, account: 'user-9' },
          occurrences: 2,
          assigneeId: AUDITOR.id,
          activities: [
            {
              id: 'act-1',
              kind: 'created',
              userId: null,
              fromStatus: null,
              toStatus: null,
              note: null,
              createdAt: AT,
            },
            {
              id: 'act-2',
              kind: 'assigned',
              userId: STAFF,
              fromStatus: null,
              toStatus: null,
              note: AUDITOR.id,
              createdAt: AT,
            },
          ],
          events: [{ eventPk: 'e1' }, { eventPk: 'e2' }, { eventPk: 'e3' }],
        }),
      );
      prisma.auditEvent.findMany.mockResolvedValueOnce([
        eventRow('e1'),
        eventRow('e2', { reason: 'mfa_failed', uaBrowser: 'Firefox', geoCountry: 'ES' }),
        eventRow('e3', {
          actorId: null,
          actorEmailHmac: 'f'.repeat(64),
          clientType: 'android',
          clientDeviceModel: 'Pixel 9',
          personal: null,
        }),
      ]);
      prisma.user.findMany.mockResolvedValueOnce([
        { id: AUDITOR.id, name: 'Ana Auditor' },
        { id: STAFF, name: 'Grace Hopper' },
      ]);
      const detail = await service.get(AUDITOR, ALERT);
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['e1', 'e2', 'e3'] } },
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(detail).toMatchObject({
        subjectLabel: 'Ada Lovelace',
        explanation: {
          looksFor:
            '10 or more failed sign-ins of one account within 15 minutes: someone guessing its password.',
          saw: ['12 failed sign-ins of Ada Lovelace (user-9) within 15 minutes.'],
        },
        evidence: {
          events: 3,
          from: AT.toISOString(),
          to: AT.toISOString(),
          outcomes: [{ value: 'failure', count: 3 }],
          reasons: [
            { value: 'invalid_credentials', count: 2 },
            { value: 'mfa_failed', count: 1 },
          ],
          actions: [{ value: 'Signed in.', count: 3 }],
          accounts: 2,
          countries: [
            { value: 'MX', count: 2 },
            { value: 'ES', count: 1 },
          ],
          devices: [
            { value: 'Firefox on Linux', count: 1 },
            { value: 'Microsoft Edge on Linux', count: 1 },
            { value: 'Pixel 9', count: 1 },
          ],
        },
        assigneeLabel: 'Ana Auditor',
        resolvedByLabel: null,
        activities: [
          { kind: 'created', userLabel: null, assigneeLabel: null },
          { kind: 'assigned', userLabel: 'Grace Hopper', assigneeLabel: 'Ana Auditor' },
        ],
      });
      expect(detail.events.map((event) => event.id)).toEqual(['e1', 'e2', 'e3']);
      expect(explorer.summaries).toHaveBeenCalledTimes(1);
      // Only ids of accounts are looked up: an assignment's "unassigned" is not one.
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: [AUDITOR.id, STAFF] } },
        select: { id: true, name: true },
      });
    });

    it('answers an alert of an application the caller may not see as missing', async () => {
      const { prisma, access, service } = setup();
      const detail = await service.get(AUDITOR, ALERT);
      // No events kept: nothing is read for them, and the evidence is empty.
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(detail).toMatchObject({
        subjectLabel: null,
        evidence: { events: 0, from: null, to: null, outcomes: [], accounts: 0 },
        events: [],
      });
      access.canSee.mockResolvedValueOnce(false);
      await expect(service.get(AUDITOR, ALERT)).rejects.toBeInstanceOf(NotFoundException);
      prisma.alert.findUnique.mockResolvedValueOnce(null);
      await expect(service.get(AUDITOR, ALERT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('changes status and assignee under the version, with their history', async () => {
      const { tx, service } = setup();
      await service.update(AUDITOR, ALERT, {
        status: 'resolved',
        assigneeId: AUDITOR.id,
        version: 0,
      });
      expect(tx.alert.updateMany).toHaveBeenCalledWith({
        where: { id: ALERT, version: 0 },
        data: expect.objectContaining({
          status: 'resolved',
          assigneeId: AUDITOR.id,
          resolvedById: AUDITOR.id,
        }) as unknown,
      });
      expect(tx.alertActivity.create.mock.calls.map(([args]) => args.data.kind)).toEqual([
        'status_changed',
        'assigned',
      ]);
    });

    it('reopens, clearing the resolution, and unassigns', async () => {
      const { tx, prisma, service } = setup();
      prisma.alert.findUnique.mockResolvedValueOnce(
        alertRow({ status: 'resolved', assigneeId: AUDITOR.id }),
      );
      await service.update(AUDITOR, ALERT, { status: 'open', assigneeId: null, version: 3 });
      expect(tx.alert.updateMany.mock.calls[0]?.[0]).toMatchObject({
        data: { status: 'open', assigneeId: null, resolvedAt: null, resolvedById: null },
      });
      expect(tx.alertActivity.create.mock.calls.map(([args]) => args.data.note)).toEqual([
        undefined,
        'unassigned',
      ]);
    });

    it('refuses a stale version, a forbidden transition, an assignee who cannot work on it', async () => {
      const { tx, prisma, access, service } = setup();
      tx.alert.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.update(AUDITOR, ALERT, { status: 'in_review', version: 0 }),
      ).rejects.toThrow(/changed since it was read/);
      prisma.alert.findUnique.mockResolvedValueOnce(alertRow({ status: 'resolved' }));
      await expect(
        service.update(AUDITOR, ALERT, { status: 'false_positive', version: 0 }),
      ).rejects.toThrow(/resolved cannot become false_positive/);
      access.canManage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(
        service.update(AUDITOR, ALERT, { assigneeId: AUDITOR.id, version: 0 }),
      ).rejects.toThrow(/assignee cannot work/);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.update(AUDITOR, ALERT, { assigneeId: AUDITOR.id, version: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
      // A disabled account, whatever its role and assignments.
      prisma.user.findUnique.mockResolvedValueOnce({
        id: AUDITOR.id,
        role: 'auditor',
        disabledAt: new Date(),
      });
      await expect(
        service.update(AUDITOR, ALERT, { assigneeId: AUDITOR.id, version: 0 }),
      ).rejects.toThrow(/assignee cannot work/);
    });

    it('refuses reopening while a newer alert of the group is open, and hides alerts it may not manage', async () => {
      const { tx, prisma, access, service } = setup();
      prisma.alert.findUnique.mockResolvedValueOnce(alertRow({ status: 'resolved' }));
      tx.alert.updateMany.mockRejectedValueOnce(
        new Error('Unique constraint failed on alerts_open_group_key'),
      );
      await expect(service.update(AUDITOR, ALERT, { status: 'open', version: 0 })).rejects.toThrow(
        /newer alert of the same group/,
      );
      tx.alert.updateMany.mockRejectedValueOnce(new Error('connection lost'));
      await expect(
        service.update(AUDITOR, ALERT, { status: 'in_review', version: 0 }),
      ).rejects.toThrow('connection lost');
      access.canManage.mockResolvedValueOnce(false);
      await expect(service.addNote(AUDITOR, ALERT, 'note')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      access.canSee.mockResolvedValueOnce(false);
      await expect(service.addNote(AUDITOR, ALERT, 'note')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.alert.findUnique.mockResolvedValueOnce(null);
      await expect(service.addNote(AUDITOR, ALERT, 'note')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('adds notes', async () => {
      const { prisma, service } = setup();
      await service.addNote(AUDITOR, ALERT, 'Checked with the user.');
      expect(prisma.alertActivity.create).toHaveBeenCalledWith({
        data: { alertId: ALERT, kind: 'note', userId: AUDITOR.id, note: 'Checked with the user.' },
      });
    });
  });

  it('counts the open alerts per severity on a timer', async () => {
    vi.useFakeTimers();
    const { prisma, service } = setup();
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const read = () =>
      (service as unknown as { openBySeverity: Map<string, number> }).openBySeverity;
    expect(read().get('high')).toBe(2);
    expect(read().get('critical')).toBe(0);
    prisma.alert.groupBy.mockRejectedValueOnce(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Could not count'));
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.alert.groupBy).toHaveBeenCalledTimes(2);
  });
});
