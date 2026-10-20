import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessService } from '../access/app-access.service.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import type { ExplorerService } from '../explorer/explorer.service.js';
import type { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import type { ActiveMute, AlertMutesService } from './alert-mutes.service.js';
import { AlertsService, type RaiseAlert } from './alerts.service.js';
import { ruleSettings } from './rule-settings.testing.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const ALERT = '0199e0b1-0000-7000-8000-0000000000a1';
const AUDITOR = { id: '0199e0b1-0000-7000-8000-00000000000b', role: 'auditor' as const };
const AT = new Date('2026-10-15T12:00:00.000Z');
const STAFF = '0199e0b1-0000-7000-8000-0000000000c1';
const PAGE = { limit: 20, offset: 0, sort: 'last_seen', order: 'desc' } as const;

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
  acknowledgedAt: null as Date | null,
  acknowledgedById: null as string | null,
  escalations: 0,
  lastEscalatedAt: null as Date | null,
  createdAt: AT,
  updatedAt: AT,
  version: 0,
  activities: [],
  events: [] as { eventPk: string }[],
  ...overrides,
});

function setup(settings = ruleSettings()) {
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
    alert: {
      updateMany: vi.fn((..._args: unknown[]) => Promise.resolve({ count: 1 })),
      findFirst: vi.fn((..._args: unknown[]) => Promise.resolve(null as unknown)),
      update: vi.fn((..._args: unknown[]) => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
      Array.isArray(work) ? Promise.all(work) : work(tx),
    ),
    alertMute: { findMany: vi.fn((_args: unknown) => Promise.resolve([] as unknown[])) },
    $queryRaw: vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown[])),
    auditEvent: { findMany: vi.fn((_args: unknown) => Promise.resolve([] as unknown[])) },
    alert: {
      findMany: vi.fn(() => Promise.resolve([alertRow()] as unknown[])),
      count: vi.fn(() => Promise.resolve(1)),
      findUnique: vi.fn(() => Promise.resolve(alertRow() as unknown)),
      groupBy: vi.fn((..._args: unknown[]) =>
        Promise.resolve([{ severity: 'high', _count: { _all: 2 } }] as unknown[]),
      ),
      findFirst: vi.fn((..._args: unknown[]) => Promise.resolve(null as unknown)),
      update: vi.fn((..._args: unknown[]) => Promise.resolve({})),
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
  const mutes = {
    active: vi.fn((..._args: unknown[]) => Promise.resolve([] as ActiveMute[])),
  };
  const service = new AlertsService(
    prisma as unknown as PrismaService,
    access as unknown as AppAccessService,
    webhooks as unknown as WebhookOutboxService,
    mail as unknown as MailOutboxService,
    explorer as unknown as ExplorerService,
    settings,
    mutes as unknown as AlertMutesService,
  );
  return { tx, prisma, access, webhooks, mail, explorer, mutes, service };
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
      // Its group is open (no flood check), then the statement adds an occurrence.
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: ALERT }])
        .mockResolvedValueOnce([{ id: ALERT, created: false }]);
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
      tx.$queryRaw.mockResolvedValueOnce([{ id: ALERT }]).mockResolvedValueOnce([]);
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
        sort: 'last_seen',
        order: 'desc',
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
            AND: [],
          },
        }),
      );
      access.canSee.mockResolvedValueOnce(false);
      await expect(service.list(AUDITOR, { appId: APP, ...PAGE })).resolves.toEqual({
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
      const page = await service.list(AUDITOR, PAGE);
      expect(page.items.map((item) => item.subjectLabel)).toEqual([
        'Ada Lovelace',
        null,
        'Grace Hopper',
      ]);
      // One query for the page, only for the applications' alerts with a subject.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.calls[0]).toContainEqual([ALERT]);

      prisma.alert.findMany.mockResolvedValueOnce([alertRow({ subject: null })]);
      await service.list(AUDITOR, PAGE);
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

  describe('rules, floods and silences', () => {
    /** The values a tagged $queryRaw call was given (its interpolations). */
    const valuesOf = (call: unknown[] | undefined) => (call ?? []).slice(1);

    it('raises nothing for a rule an administrator turned off', async () => {
      const { tx, service } = setup(ruleSettings({ brute_force_account: { enabled: false } }));
      await expect(service.raise(tx as never, raise())).resolves.toBeNull();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.alertActivity.create).not.toHaveBeenCalled();
    });

    it("raises with the administrator's severity in place of the rule's", async () => {
      const { tx, service } = setup(
        ruleSettings({ brute_force_account: { severity: 'critical' } }),
      );
      tx.$queryRaw.mockResolvedValueOnce([{ id: ALERT }]); // its group is open
      await service.raise(tx as never, raise({ severity: 'high' }));
      expect(valuesOf(tx.$queryRaw.mock.calls[1])).toContain('critical');
    });

    it("folds a rule's new groups into one alert past its hourly cap, never past it otherwise", async () => {
      const capped = setup();
      capped.tx.$queryRaw
        .mockResolvedValueOnce([]) // a new group
        .mockResolvedValueOnce([{ count: 20 }]) // 20 new alerts of the rule this hour
        .mockResolvedValueOnce([{ id: ALERT, created: true }]);
      await capped.service.raise(
        capped.tx as never,
        raise({ groupKey: 'brute_force_account:x:user-77' }),
      );
      const insert = valuesOf(capped.tx.$queryRaw.mock.calls[2]);
      expect(insert).toContain(`brute_force_account:${APP}:flood`);
      expect(insert).not.toContain('user-9'); // no subject: it is about many
      expect(
        insert.find((value) => typeof value === 'string' && value.startsWith('More than 20')),
      ).toBeDefined();

      const under = setup();
      under.tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 19 }])
        .mockResolvedValueOnce([{ id: ALERT, created: true }]);
      await under.service.raise(
        under.tx as never,
        raise({ groupKey: 'brute_force_account:x:user-77' }),
      );
      expect(valuesOf(under.tx.$queryRaw.mock.calls[2])).toContain('brute_force_account:x:user-77');
    });

    it("keeps a silenced alert's people quiet, never its application's webhook", async () => {
      const { tx, webhooks, mail, mutes, service } = setup();
      webhooks.chatTargets = ['slack'];
      const until = new Date(AT.getTime() + 3_600_000);
      mutes.active.mockResolvedValueOnce([{ id: 'm1', appId: APP, rule: null, until }]);
      await service.raise(tx as never, raise({ severity: 'critical' }));
      expect(webhooks.toApp).toHaveBeenCalled();
      expect(webhooks.toChat).not.toHaveBeenCalled();
      expect(mail.enqueue).not.toHaveBeenCalled();
      const notified = tx.alertActivity.create.mock.calls.find(
        ([args]) => args.data.kind === 'notified',
      );
      expect(notified?.[0].data.note).toBe(
        `webhook, silenced until ${until.toISOString()}: no email or chat`,
      );
    });
  });

  describe('acknowledgement and closing', () => {
    it('acknowledges an open alert: In review, its assignee, its history', async () => {
      const { tx, service } = setup();
      await service.acknowledge(AUDITOR, ALERT, 0);
      const data = tx.alert.updateMany.mock.calls[0]?.[0] as {
        where: unknown;
        data: Record<string, unknown>;
      };
      expect(data.where).toEqual({ id: ALERT, version: 0 });
      expect(data.data).toMatchObject({
        status: 'in_review',
        acknowledgedById: AUDITOR.id,
        assigneeId: AUDITOR.id,
      });
      expect(data.data.acknowledgedAt).toBeInstanceOf(Date);
      expect(tx.alertActivity.create.mock.calls.map(([args]) => args.data.kind)).toEqual([
        'acknowledged',
        'assigned',
      ]);
    });

    it('refuses to acknowledge a closed alert, one already acknowledged, or a stale version', async () => {
      const closed = setup();
      closed.prisma.alert.findUnique.mockResolvedValueOnce(alertRow({ status: 'resolved' }));
      await expect(closed.service.acknowledge(AUDITOR, ALERT, 0)).rejects.toBeInstanceOf(
        ConflictException,
      );
      const taken = setup();
      taken.prisma.alert.findUnique.mockResolvedValueOnce(
        alertRow({ status: 'in_review', acknowledgedAt: AT, acknowledgedById: STAFF }),
      );
      await expect(taken.service.acknowledge(AUDITOR, ALERT, 0)).rejects.toBeInstanceOf(
        ConflictException,
      );
      const stale = setup();
      stale.tx.alert.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(stale.service.acknowledge(AUDITOR, ALERT, 0)).rejects.toThrow(/changed since/);
    });

    it('keeps the reason a closing gives, and starts the escalation over on reopening', async () => {
      const { tx, prisma, service } = setup();
      await service.update(AUDITOR, ALERT, {
        status: 'false_positive',
        reason: 'The new phone was confirmed by the user.',
        version: 0,
      });
      expect(tx.alertActivity.create.mock.calls[0]?.[0].data).toMatchObject({
        kind: 'status_changed',
        toStatus: 'false_positive',
        note: 'The new phone was confirmed by the user.',
      });

      prisma.alert.findUnique.mockResolvedValueOnce(
        alertRow({
          status: 'resolved',
          acknowledgedAt: AT,
          acknowledgedById: STAFF,
          escalations: 2,
        }),
      );
      await service.update(AUDITOR, ALERT, { status: 'open', version: 1 });
      expect(tx.alert.updateMany.mock.calls[1]?.[0]).toMatchObject({
        data: {
          status: 'open',
          acknowledgedAt: null,
          acknowledgedById: null,
          escalations: 0,
          lastEscalatedAt: null,
        },
      });
    });

    it('takes an alert on when it moves to In review, once', async () => {
      const { tx, prisma, service } = setup();
      await service.update(AUDITOR, ALERT, { status: 'in_review', version: 0 });
      expect(tx.alert.updateMany.mock.calls[0]?.[0]).toMatchObject({
        data: { status: 'in_review', acknowledgedById: AUDITOR.id },
      });
      prisma.alert.findUnique.mockResolvedValueOnce(
        alertRow({ status: 'open', acknowledgedAt: AT, acknowledgedById: STAFF }),
      );
      await service.update(AUDITOR, ALERT, { status: 'in_review', version: 1 });
      expect(tx.alert.updateMany.mock.calls[1]?.[0]).not.toHaveProperty('data.acknowledgedById');
    });

    it('touches the alert with a note, so whoever has it open sees it', async () => {
      const { prisma, service } = setup();
      await service.addNote(AUDITOR, ALERT, 'Checked with the user.');
      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: ALERT },
        data: { updatedAt: expect.any(Date) as unknown },
      });
    });
  });

  describe('counting, searching and conditions', () => {
    it('counts the unresolved alerts by severity, the silenced ones and the oldest open', async () => {
      const { prisma, mutes, service } = setup();
      prisma.alert.groupBy.mockResolvedValueOnce([
        { status: 'open', severity: 'critical', _count: { _all: 2 } },
        { status: 'in_review', severity: 'high', _count: { _all: 1 } },
      ]);
      prisma.alert.findFirst.mockResolvedValueOnce({ createdAt: AT });
      prisma.alertMute.findMany.mockResolvedValueOnce([{ appId: APP }]);
      mutes.active.mockResolvedValueOnce([
        { id: 'm1', appId: APP, rule: 'brute_force_ip', until: AT },
      ]);
      prisma.alert.count.mockResolvedValueOnce(3);
      await expect(service.summary(AUDITOR)).resolves.toEqual({
        open: { info: 0, low: 0, medium: 0, high: 0, critical: 2 },
        inReview: { info: 0, low: 0, medium: 0, high: 1, critical: 0 },
        muted: 3,
        oldestOpenAt: AT.toISOString(),
      });
    });

    it('answers nothing of an application the caller may not see', async () => {
      const { access, prisma, service } = setup();
      access.canSee.mockResolvedValueOnce(false);
      const summary = await service.summary(AUDITOR, APP);
      expect(summary.open.critical).toBe(0);
      expect(prisma.alert.groupBy).not.toHaveBeenCalled();
    });

    it('searches by id, rule, title or subject, filters the silenced ones and orders as asked', async () => {
      const { prisma, mutes, service } = setup();
      mutes.active.mockResolvedValue([{ id: 'm1', appId: APP, rule: 'brute_force_ip', until: AT }]);
      prisma.alertMute.findMany.mockResolvedValue([{ appId: APP }]);
      await service.list(AUDITOR, {
        ...PAGE,
        q: ALERT,
        muted: 'true',
        sort: 'severity',
        order: 'desc',
      });
      const call = prisma.alert.findMany.mock.calls[0] as unknown as [
        { where: { AND: unknown[] }; orderBy: unknown },
      ];
      expect(call[0].where.AND).toEqual([
        {
          OR: [
            { id: ALERT },
            { rule: { startsWith: ALERT } },
            { title: { contains: ALERT, mode: 'insensitive' } },
            { subject: ALERT },
          ],
        },
        { OR: [{ appId: APP, rule: 'brute_force_ip' }] },
      ]);
      expect(call[0].orderBy).toEqual([
        { severity: 'desc' },
        { lastSeenAt: 'desc' },
        { id: 'desc' },
      ]);
      await service.list(AUDITOR, { ...PAGE, muted: 'false' });
      const second = prisma.alert.findMany.mock.calls[1] as unknown as [
        { where: { AND: unknown[] } },
      ];
      expect(second[0].where.AND).toEqual([
        { NOT: { OR: [{ appId: APP, rule: 'brute_force_ip' }] } },
      ]);
    });

    it('holds one alert per condition: raised once, refreshed every 10 minutes, then resolved by itself', async () => {
      const { tx, service } = setup();
      const condition = raise({
        rule: 'source_silent',
        groupKey: `source_silent:${APP}`,
        eventPks: [],
      });
      await service.condition(tx as never, condition);
      expect(tx.$queryRaw).toHaveBeenCalled(); // raised

      const held = setup();
      held.tx.alert.findFirst.mockResolvedValueOnce({
        id: ALERT,
        lastSeenAt: new Date(AT.getTime() - 60_000),
      });
      await held.service.condition(held.tx as never, condition);
      expect(held.tx.alert.update).not.toHaveBeenCalled();
      held.tx.alert.findFirst.mockResolvedValueOnce({
        id: ALERT,
        lastSeenAt: new Date(AT.getTime() - 600_000),
      });
      await held.service.condition(held.tx as never, condition);
      expect(held.tx.alert.update).toHaveBeenCalledWith({
        where: { id: ALERT },
        data: { lastSeenAt: AT, summary: condition.summary },
      });

      await expect(
        held.service.resolveCleared(held.tx as never, condition.groupKey, 'Back.'),
      ).resolves.toBeNull();
      held.tx.alert.findFirst.mockResolvedValueOnce({ id: ALERT, status: 'open' });
      await expect(
        held.service.resolveCleared(held.tx as never, condition.groupKey, 'Back.'),
      ).resolves.toBe(ALERT);
      expect(held.tx.alertActivity.create).toHaveBeenLastCalledWith({
        data: {
          alertId: ALERT,
          kind: 'status_changed',
          fromStatus: 'open',
          toStatus: 'resolved',
          note: 'Back.',
        },
      });
    });
  });
});
