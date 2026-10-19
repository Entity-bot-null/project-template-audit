import { BadRequestException, NotFoundException } from '@nestjs/common';
import { emailHmac } from 'audit-contract/node';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessService } from '../access/app-access.service.js';
import type { RequestUser } from '../common/types/request-user.js';
import {
  type ConnectedAppsService,
  SYSTEM_APP_ID,
} from '../connected-apps/connected-apps.service.js';
import type { EnrichmentService } from '../enrichment/enrichment.service.js';
import { HUB_ACTIONS, hubActionsTagged } from '../hub-audit/hub-actions.js';
import type { HubAuditService, HubEventInput } from '../hub-audit/hub-audit.service.js';
import type { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { ExplorerService, SUMMARY_SELECT, toSummary } from './explorer.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const OTHER = '0199e0b1-0000-7000-8000-000000000002';
const QUIET = '0199e0b1-0000-7000-8000-000000000003';
const ADMIN: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000a', role: 'admin' };
const AUDITOR: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000b', role: 'auditor' };
const VIEWER: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000c', role: 'viewer' };
const MEMBER: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000d', role: 'member' };
const NOW = new Date('2026-10-15T12:00:00.000Z');
const DAY_MS = 86_400_000;
const PSEUDONYM_KEY = Buffer.alloc(32, 7);
const REQ = { ip: '203.0.113.7' } as Request;

const id = (n: number) => `0199e0b1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const minus = (n: number) => new Date(NOW.getTime() - n * 1000);
/** When the blocked subjects of these specs had their first erasure. */
const BLOCKED_AT = minus(3600);
/** Their last erasure: what occurred up to it (every row of these specs, minus(2) and older) is blocked. */
const BLOCKED_THROUGH = minus(1);
/** What a search leaves out of an application where the subject is blocked. */
const left = (...appIds: string[]) => ({
  NOT: { OR: appIds.map((appId) => ({ appId, occurredAt: { lte: BLOCKED_THROUGH } })) },
});

const summaryRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(n),
  eventId: id(1000 + n),
  appId: APP,
  recordedAt: minus(n),
  occurredAt: minus(n + 1),
  category: 'security',
  action: 'auth.session.signed_in',
  outcome: 'success',
  severity: 'info',
  riskScore: 0,
  actorType: 'user',
  actorId: 'user-7',
  actorRole: 'member',
  resourceType: null,
  resourceId: null,
  requestId: null,
  httpStatus: null,
  clientType: 'web',
  geoCountry: null,
  ipScope: 'public',
  app: { slug: 'my-project' },
  catalogVersionId: null,
  personal: null,
  ...overrides,
});

/** What toSummary makes of summaryRow(n). */
const summaryOf = (n: number) => ({
  id: id(n),
  eventId: id(1000 + n),
  appId: APP,
  appSlug: 'my-project',
  recordedAt: minus(n).toISOString(),
  occurredAt: minus(n + 1).toISOString(),
  category: 'security',
  action: 'auth.session.signed_in',
  outcome: 'success',
  description: null,
  severity: 'info',
  riskScore: 0,
  actor: { type: 'user', id: 'user-7', role: 'member', label: null },
  resource: null,
  requestId: null,
  httpStatus: null,
  clientType: 'web',
  country: null,
  ipScope: 'public',
});

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  ...summaryRow(1, { requestId: 'req-42', httpStatus: 201 }),
  sequenceEpoch: 'epoch-1',
  sourceSeq: 42n,
  catalogVersionId: 'catalog-version-1',
  reason: 'Support ticket 7',
  actorEmailHmac: 'email-pseudonym',
  impersonatorId: null,
  sessionRef: 'session-1',
  parentResourceType: 'workspace',
  parentResourceId: 'ws-1',
  changeBefore: { name: 'Ada' },
  changeAfter: { name: 'Ada L.' },
  changedFields: ['name'],
  httpMethod: 'POST',
  httpRoute: '/api/sessions',
  traceId: 'trace-1',
  durationMs: 12,
  clientAppVersion: '1.2.3',
  clientAppBuild: '45',
  clientOs: 'Android',
  clientOsVersion: '15',
  clientDeviceModel: 'Pixel 9',
  clientLocale: 'es-ES',
  clientTimeZone: 'Europe/Madrid',
  clientNetworkType: 'wifi',
  clientRoute: '/home',
  clientSdk: 'audit-sdk/1.0.0',
  clientDeclared: ['os'],
  geoAsn: 64500,
  uaBrowser: 'Firefox',
  uaOs: 'Linux',
  uaDeviceClass: 'desktop',
  details: { method: 'password' },
  personal: {
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    deviceId: 'device-1',
    actorLabel: 'Ada',
    resourceLabel: null,
    geoSubdivision: 'MD',
    geoCity: 'Madrid',
    geoLatitude: '40.417',
    geoLongitude: '-3.704',
    geoAccuracyKm: 20,
    personalChange: { email: 'ada@example.com' },
    actorPhone: '•••• 5678',
    clientHints: {
      brands: [{ brand: 'Microsoft Edge', version: '155.0.3405.80' }],
      platform: 'Linux',
    },
  },
  contentHash: Buffer.alloc(32, 1),
  location: { latitude: '40.4168', longitude: '-3.7038', accuracyM: 25, capturedAt: minus(60) },
  truncatedFields: [],
  droppedFields: ['client.extra'],
  flags: ['clock_skew'],
  ...overrides,
});

type Args = Record<string, unknown>;
/** A subject's first and last event (auditEvent.aggregate): null when never seen. */
interface Bounds {
  _min: { recordedAt: Date | null };
  _max: { recordedAt: Date | null };
}

function setup(geolocation = false) {
  const prisma = {
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([] as unknown[]),
    ),
    auditEvent: {
      findMany: vi.fn((_args: Args) => Promise.resolve([summaryRow(1)] as unknown[])),
      findUnique: vi.fn((_args: Args) => Promise.resolve(detailRow() as unknown)),
      aggregate: vi.fn((_args: Args): Promise<Bounds> =>
        Promise.resolve({ _min: { recordedAt: minus(90) }, _max: { recordedAt: minus(1) } }),
      ),
      groupBy: vi.fn((_args: Args) => Promise.resolve([] as unknown[])),
    },
    actorProfile: {
      findUnique: vi.fn((_args: Args) => Promise.resolve({ lastSignInAt: minus(5) } as unknown)),
    },
    actorDevice: { count: vi.fn((_args: Args) => Promise.resolve(2)) },
    actorCountry: {
      findMany: vi.fn((_args: Args) => Promise.resolve([{ country: 'ES' }, { country: 'PT' }])),
    },
    alert: {
      count: vi.fn((_args: Args) => Promise.resolve(1)),
      groupBy: vi.fn((_args: Args) => Promise.resolve([] as unknown[])),
    },
    catalogAction: {
      findUnique: vi.fn((_args: Args) =>
        Promise.resolve({ description: 'A user signed in.', tags: ['auth.sign_in'] } as unknown),
      ),
      findMany: vi.fn((_args: Args) => Promise.resolve([] as unknown[])),
    },
    user: { findMany: vi.fn((_args: Args) => Promise.resolve([] as unknown[])) },
    integritySeal: { findFirst: vi.fn((_args: Args) => Promise.resolve(null as unknown)) },
    integrityVerification: { findMany: vi.fn((_args: Args) => Promise.resolve([] as unknown[])) },
    connectedApp: {
      findUnique: vi.fn((_args: Args) =>
        Promise.resolve({ id: APP, correlationEnabled: false } as unknown),
      ),
      findMany: vi.fn((_args: Args) => Promise.resolve([] as unknown[])),
    },
    ingestException: { groupBy: vi.fn((_args: Args) => Promise.resolve([] as unknown[])) },
    connectorInstance: { groupBy: vi.fn((_args: Args) => Promise.resolve([] as unknown[])) },
    sequenceGap: { groupBy: vi.fn((_args: Args) => Promise.resolve([] as unknown[])) },
  };
  // As AppAccessService answers: an admin sees every application, an auditor
  // or a viewer APP (assigned to them), a member none.
  const assigned = (user: RequestUser) => (user.role === 'member' ? [] : [APP]);
  const access = {
    canSee: vi.fn((user: RequestUser, appId: string) =>
      Promise.resolve(user.role === 'admin' || assigned(user).includes(appId)),
    ),
    appFilter: vi.fn((user: RequestUser) =>
      Promise.resolve(user.role === 'admin' ? {} : { appId: { in: assigned(user) } }),
    ),
  };
  const apps = { pseudonymKey: vi.fn((_appId: string) => Promise.resolve(PSEUDONYM_KEY)) };
  const hubAudit = { record: vi.fn((_input: HubEventInput) => Promise.resolve('hub-event')) };
  const enrichment = { geolocation };
  const service = new ExplorerService(
    prisma as unknown as PrismaService,
    access as unknown as AppAccessService,
    apps as unknown as ConnectedAppsService,
    hubAudit as unknown as HubAuditService,
    enrichment as unknown as EnrichmentService,
  );
  return { prisma, access, apps, hubAudit, service };
}

/** The values a tagged-template call passed (strings first, then values). */
const valuesOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) => call?.slice(1) ?? [];

/** The subject and the application (null: any) a blocked lookup asked about. */
const lookupOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) =>
  valuesOf(call).slice(0, 3);
const sqlOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) => call?.[0].join('?') ?? '';

interface Database {
  /** Each subject blocked in the applications given, since BLOCKED_AT, through BLOCKED_THROUGH. */
  blocked?: Record<string, string[]>;
  /** The blocked subjects with the email pseudonyms asked for (blockedWithEmail). */
  people?: { appId: string; subject: string; through: Date }[];
  /** The applications where the person appears, unblocked (presentUnblocked). */
  present?: string[];
  /** The subject's shared email pseudonyms. */
  pseudonyms?: string[];
}

/** Answers the raw queries (explorer/blocked.ts, the correlation) as the database would. */
function database(prisma: ReturnType<typeof setup>['prisma'], answers: Database) {
  prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('AS "pseudonym"')) {
      return Promise.resolve((answers.pseudonyms ?? []).map((pseudonym) => ({ pseudonym })));
    }
    if (sql.includes('unnest(')) {
      return Promise.resolve((answers.present ?? []).map((appId) => ({ appId })));
    }
    if (sql.includes('r."subject", max(r."created_at")'))
      return Promise.resolve(answers.people ?? []);
    const [subject, appId] = values as [string, string | null];
    return Promise.resolve(
      (answers.blocked?.[subject] ?? [])
        .filter((app) => appId === null || app === appId)
        .map((app) => ({ appId: app, since: BLOCKED_AT, through: BLOCKED_THROUGH })),
    );
  });
}

/** Answers the blocked lookup: each subject blocked in the applications given. */
const blockedIn = (prisma: ReturnType<typeof setup>['prisma'], apps: Record<string, string[]>) => {
  database(prisma, { blocked: apps });
};

describe('ExplorerService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('whereOf', () => {
    it("keeps every query inside the caller's applications, by role", async () => {
      const { access, service } = setup();
      await expect(service.whereOf(ADMIN, {})).resolves.toEqual({});
      await expect(service.whereOf(AUDITOR, {})).resolves.toEqual({ appId: { in: [APP] } });
      await expect(service.whereOf(VIEWER, {})).resolves.toEqual({ appId: { in: [APP] } });
      await expect(service.whereOf(MEMBER, {})).resolves.toEqual({ appId: { in: [] } });
      expect(access.canSee).not.toHaveBeenCalled();
    });

    it('narrows to one visible application, and answers nothing visible for another', async () => {
      const { access, service } = setup();
      await expect(service.whereOf(AUDITOR, { appId: APP })).resolves.toEqual({ appId: APP });
      await expect(service.whereOf(ADMIN, { appId: OTHER })).resolves.toEqual({ appId: OTHER });
      await expect(service.whereOf(AUDITOR, { appId: OTHER })).resolves.toBeUndefined();
      await expect(service.whereOf(MEMBER, { appId: APP })).resolves.toBeUndefined();
      expect(access.canSee).toHaveBeenCalledWith(AUDITOR, OTHER);
    });

    it('refuses an email without an application: its pseudonyms are its own (400)', async () => {
      const { access, apps, service } = setup();
      const asked = service.whereOf(AUDITOR, { email: 'ada@example.com' });
      await expect(asked).rejects.toThrow(BadRequestException);
      await expect(asked).rejects.toThrow(/choose an application/);
      expect(access.canSee).not.toHaveBeenCalled();
      expect(apps.pseudonymKey).not.toHaveBeenCalled();
    });

    it("matches an email by the application's pseudonym, never by its value", async () => {
      const { apps, service } = setup();
      const where = await service.whereOf(AUDITOR, { appId: APP, email: 'Ada@Example.com' });
      expect(apps.pseudonymKey).toHaveBeenCalledWith(APP);
      expect(where).toEqual({
        appId: APP,
        actorEmailHmac: emailHmac(PSEUDONYM_KEY, 'ada@example.com'),
      });
      expect(JSON.stringify(where)).not.toContain('example.com');
    });

    it('turns every filter into its column', async () => {
      const { service } = setup();
      await expect(
        service.whereOf(ADMIN, {
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-15T00:00:00.000Z',
          category: 'security',
          action: 'auth.session.signed_in',
          outcome: 'failure',
          severity: 'high',
          minRisk: 60,
          actorId: 'user-7',
          resourceType: 'document',
          resourceId: 'doc-1',
          // IPv4-mapped IPv6: matched as the IPv4 address it is.
          ip: '::ffff:198.51.100.20',
          country: 'ES',
          clientType: 'android',
          requestId: 'req-42',
        }),
      ).resolves.toEqual({
        recordedAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-15T00:00:00.000Z'),
        },
        category: 'security',
        action: 'auth.session.signed_in',
        outcome: 'failure',
        severity: 'high',
        riskScore: { gte: 60 },
        actorId: 'user-7',
        resourceType: 'document',
        resourceId: 'doc-1',
        personal: { is: { ip: '198.51.100.20' } },
        geoCountry: 'ES',
        clientType: 'android',
        requestId: 'req-42',
      });
    });

    it('bounds the time on one side only when only one is given, and ignores what is no IP', async () => {
      const { service } = setup();
      const from = '2026-10-01T00:00:00.000Z';
      await expect(service.whereOf(ADMIN, { from })).resolves.toEqual({
        recordedAt: { gte: new Date(from) },
      });
      await expect(service.whereOf(ADMIN, { to: from })).resolves.toEqual({
        recordedAt: { lt: new Date(from) },
      });
      await expect(service.whereOf(ADMIN, { ip: 'not-an-ip' })).resolves.toEqual({});
    });
  });

  describe('search', () => {
    it('answers a page in the explorer order, after the cursor, and records the filter names', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce([
        summaryRow(4),
        summaryRow(5),
        summaryRow(6),
      ]);
      const cursor = encodeCursor({ recordedAt: minus(3), id: id(3) });
      const page = await service.search(
        AUDITOR,
        { appId: APP, outcome: 'success', actorId: undefined, cursor, limit: 2 },
        REQ,
      );
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            { appId: APP, outcome: 'success' },
            {
              OR: [{ recordedAt: { lt: minus(3) } }, { recordedAt: minus(3), id: { lt: id(3) } }],
            },
          ],
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: SUMMARY_SELECT,
      });
      expect(page.items).toEqual([summaryOf(4), summaryOf(5)]);
      expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
        recordedAt: minus(5),
        id: id(5),
      });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.events.searched',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        details: { appId: APP, filters: ['appId', 'outcome'], results: 2 },
        request: REQ,
      });
    });

    it('answers an empty page, without a query, for an application the caller may not see', async () => {
      const { prisma, hubAudit, service } = setup();
      await expect(service.search(AUDITOR, { appId: OTHER, limit: 50 }, REQ)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
      expect(hubAudit.record.mock.calls[0]![0].details).toEqual({
        appId: OTHER,
        filters: ['appId'],
        results: 0,
      });
    });

    it('records a search across applications without an appId', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce([]);
      await expect(service.search(MEMBER, { limit: 50 }, REQ)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [{ appId: { in: [] } }, {}],
      });
      expect(hubAudit.record.mock.calls[0]![0].details).toEqual({ filters: [], results: 0 });
    });

    it('refuses a cursor it did not give (400), recording nothing', async () => {
      const { hubAudit, service } = setup();
      await expect(service.search(ADMIN, { cursor: 'bogus', limit: 50 }, REQ)).rejects.toThrow(
        BadRequestException,
      );
      expect(hubAudit.record).not.toHaveBeenCalled();
    });

    it('leaves out what occurred up to the last erasure where the subject searched by id is blocked, and says so', async () => {
      const { prisma, hubAudit, service } = setup();
      blockedIn(prisma, { 'user-7': [OTHER] });
      const page = await service.search(ADMIN, { actorId: 'user-7', limit: 50 }, REQ);
      expect(lookupOf(prisma.$queryRaw.mock.calls[0])).toEqual(['user-7', null, null]);
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [{ actorId: 'user-7' }, left(OTHER), {}],
      });
      expect(page).toEqual({ items: [summaryOf(1)], nextCursor: null, blocked: true });
      expect(hubAudit.record.mock.calls[0]![0].details).toEqual({
        filters: ['actorId'],
        results: 1,
      });
    });

    it('looks nothing up for an application the caller does not see, and says nothing of it', async () => {
      const { prisma, service } = setup();
      blockedIn(prisma, { 'user-7': [OTHER] });
      const page = await service.search(
        AUDITOR,
        { appId: OTHER, actorId: 'user-7', limit: 50 },
        REQ,
      );
      expect(page).toEqual({ items: [], nextCursor: null });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      // Visible, but the subject is blocked only where the caller does not look.
      const mine = await service.search(AUDITOR, { actorId: 'user-7', limit: 50 }, REQ);
      expect(mine).not.toHaveProperty('blocked');
    });

    it('searches a subject blocked nowhere as any other, without saying blocked', async () => {
      const { prisma, service } = setup();
      const page = await service.search(
        ADMIN,
        { resourceType: 'user', resourceId: 'user-7', limit: 50 },
        REQ,
      );
      expect(lookupOf(prisma.$queryRaw.mock.calls[0])).toEqual(['user-7', null, null]);
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [{ resourceType: 'user', resourceId: 'user-7' }, {}],
      });
      expect(page).toEqual({ items: [summaryOf(1)], nextCursor: null });
    });
  });

  describe('blockedBy', () => {
    it('looks up the actor and the user searched for, each application once', async () => {
      const { prisma, service } = setup();
      blockedIn(prisma, { 'user-7': [OTHER], 'user-8': [OTHER, QUIET] });
      await expect(
        service.blockedBy(ADMIN, {
          actorId: 'user-7',
          resourceType: 'user',
          resourceId: 'user-8',
        }),
      ).resolves.toEqual({
        apps: [OTHER, QUIET],
        where: [left(OTHER, OTHER, QUIET)],
      });
      expect(prisma.$queryRaw.mock.calls.map(lookupOf)).toEqual([
        ['user-7', null, null],
        ['user-8', null, null],
      ]);
    });

    it('looks nothing up without a subject id, or for a resource that is no user', async () => {
      const { prisma, service } = setup();
      const none = { apps: [], where: [] };
      await expect(service.blockedBy(ADMIN, {})).resolves.toEqual(none);
      await expect(
        service.blockedBy(ADMIN, { resourceType: 'document', resourceId: 'doc-1' }),
      ).resolves.toEqual(none);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('says nothing of an erasure in an application not searched, or one the caller does not see', async () => {
      const { prisma, service } = setup();
      blockedIn(prisma, { 'user-7': [OTHER] });
      const none = { apps: [], where: [] };
      await expect(service.blockedBy(AUDITOR, { actorId: 'user-7' })).resolves.toEqual(none);
      await expect(service.blockedBy(ADMIN, { appId: APP, actorId: 'user-7' })).resolves.toEqual(
        none,
      );
      await expect(service.blockedBy(ADMIN, { appId: OTHER, actorId: 'user-7' })).resolves.toEqual({
        apps: [OTHER],
        where: [left(OTHER)],
      });
    });

    it('leaves out the blocked subjects with the address searched for, in its application', async () => {
      const { prisma, apps, service } = setup();
      database(prisma, { people: [{ appId: APP, subject: 'user-9', through: BLOCKED_THROUGH }] });
      await expect(
        service.blockedBy(AUDITOR, { appId: APP, email: 'ada@example.com' }),
      ).resolves.toEqual({
        apps: [APP],
        where: [
          {
            NOT: {
              OR: [{ appId: APP, actorId: 'user-9', occurredAt: { lte: BLOCKED_THROUGH } }],
            },
          },
        ],
      });
      expect(apps.pseudonymKey).toHaveBeenCalledWith(APP);
      const [call] = prisma.$queryRaw.mock.calls;
      expect(sqlOf(call)).toContain('r."subject", max(r."created_at")');
      expect(valuesOf(call)[0]).toEqual([APP]);
      expect(valuesOf(call)[3]).toEqual([emailHmac(PSEUDONYM_KEY, 'ada@example.com')]);

      // Nobody blocked with that address, or an application the caller does not see.
      database(prisma, {});
      await expect(
        service.blockedBy(AUDITOR, { appId: APP, email: 'ada@example.com' }),
      ).resolves.toEqual({ apps: [], where: [] });
      prisma.$queryRaw.mockClear();
      await expect(
        service.blockedBy(AUDITOR, { appId: OTHER, email: 'ada@example.com' }),
      ).resolves.toEqual({ apps: [], where: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('opens an event with every section, its catalog entry, its request and its integrity', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce([summaryRow(2, { requestId: 'req-42' })]);
      prisma.integritySeal.findFirst.mockResolvedValueOnce({
        sealNo: 7n,
        createdAt: minus(100),
        sealHash: Buffer.alloc(32, 2),
        signature: Buffer.from('signature'),
        keyId: 'key-1',
      });
      prisma.integrityVerification.findMany.mockResolvedValueOnce([
        { scope: { appId: OTHER }, finishedAt: minus(10) },
        { scope: { appId: APP }, finishedAt: minus(20) },
      ]);
      const detail = await service.detail(VIEWER, id(1), REQ);

      expect(prisma.auditEvent.findUnique).toHaveBeenCalledWith({
        where: { id: id(1) },
        include: { app: { select: { slug: true } }, personal: true, location: true },
      });
      expect(detail).toEqual({
        ...summaryOf(1),
        // In words: its catalog's description, and the label its application sent.
        description: 'A user signed in.',
        actor: { type: 'user', id: 'user-7', role: 'member', label: 'Ada' },
        requestId: 'req-42',
        httpStatus: 201,
        // Its actor has no erasure run: not blocked.
        blockedSince: null,
        sequence: { epoch: 'epoch-1', seq: '42' },
        catalog: { description: 'A user signed in.', tags: ['auth.sign_in'] },
        reason: 'Support ticket 7',
        actorDetail: {
          emailPseudonym: 'email-pseudonym',
          impersonatorId: null,
          sessionRef: 'session-1',
        },
        parentResource: { type: 'workspace', id: 'ws-1' },
        change: { before: { name: 'Ada' }, after: { name: 'Ada L.' }, fields: ['name'] },
        request: {
          method: 'POST',
          route: '/api/sessions',
          traceId: 'trace-1',
          durationMs: 12,
        },
        client: {
          appVersion: '1.2.3',
          appBuild: '45',
          os: 'Android',
          osVersion: '15',
          deviceModel: 'Pixel 9',
          locale: 'es-ES',
          timeZone: 'Europe/Madrid',
          networkType: 'wifi',
          route: '/home',
          sdk: 'audit-sdk/1.0.0',
          declared: ['os'],
        },
        network: { asn: 64500, browser: 'Firefox', os: 'Linux', deviceClass: 'desktop' },
        details: { method: 'password' },
        personal: {
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
          // Read when opened, its client hints first: "Mozilla/5.0" says nothing.
          agent: { browser: 'Microsoft Edge 155.0.3405.80', os: 'Linux', device: null },
          deviceId: 'device-1',
          actorLabel: 'Ada',
          actorPhone: '•••• 5678',
          resourceLabel: null,
          subdivision: 'MD',
          city: 'Madrid',
          approximateLocation: { latitude: 40.417, longitude: -3.704, accuracyKm: 20 },
          change: { email: 'ada@example.com' },
        },
        location: {
          latitude: 40.4168,
          longitude: -3.7038,
          accuracyM: 25,
          capturedAt: minus(60).toISOString(),
        },
        quality: { truncatedFields: [], droppedFields: ['client.extra'], flags: ['clock_skew'] },
        // The last passing run that covers its application, after it was sealed.
        integrity: {
          sealed: true,
          sealNo: '7',
          verifiedAt: minus(20).toISOString(),
          contentHash: '01'.repeat(32),
          seal: {
            hash: '02'.repeat(32),
            signature: Buffer.from('signature').toString('base64'),
            keyId: 'key-1',
          },
        },
        related: [{ ...summaryOf(2), requestId: 'req-42' }],
      });

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: { appId: APP, requestId: 'req-42', id: { not: id(1) } },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: SUMMARY_SELECT,
      });
      expect(prisma.catalogAction.findUnique).toHaveBeenCalledWith({
        where: {
          catalogVersionId_action: {
            catalogVersionId: 'catalog-version-1',
            action: 'auth.session.signed_in',
          },
        },
        select: { description: true, tags: true },
      });
      expect(prisma.integritySeal.findFirst).toHaveBeenCalledWith({
        where: {
          appId: APP,
          category: 'security',
          windowFrom: { lte: minus(1) },
          windowTo: { gt: minus(1) },
        },
        select: { sealNo: true, createdAt: true, sealHash: true, signature: true, keyId: true },
      });
      expect(prisma.integrityVerification.findMany).toHaveBeenCalledWith({
        where: { outcome: 'passed', startedAt: { gt: minus(100) } },
        orderBy: { finishedAt: 'desc' },
        take: 20,
        select: { scope: true, finishedAt: true },
      });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.event.viewed',
        actor: { type: 'user', id: VIEWER.id, role: 'viewer' },
        resource: { type: 'audit_event', id: id(1) },
        details: { appId: APP },
        request: REQ,
      });
    });

    it('answers null for what is gone or unknown: personal data, location, sequence, parent, seal', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValueOnce(
        detailRow({
          requestId: null,
          sourceSeq: null,
          parentResourceId: null,
          personal: null,
          location: null,
        }),
      );
      const detail = await service.detail(AUDITOR, id(1), REQ);
      expect(detail).toMatchObject({
        requestId: null,
        sequence: null,
        parentResource: null,
        personal: null,
        location: null,
        integrity: { sealed: false, sealNo: null, verifiedAt: null, seal: null },
        related: [],
      });
      // No request id: no query for the related events.
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
      expect(prisma.integrityVerification.findMany).not.toHaveBeenCalled();

      prisma.auditEvent.findUnique.mockResolvedValueOnce(
        detailRow({ sequenceEpoch: null, parentResourceType: null }),
      );
      prisma.auditEvent.findMany.mockResolvedValueOnce([]);
      await expect(service.detail(AUDITOR, id(1), REQ)).resolves.toMatchObject({
        sequence: null,
        parentResource: null,
      });
    });

    it("describes Audit Hub's own actions from its catalog, and any other uncatalogued one as unknown", async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique
        .mockResolvedValueOnce(
          detailRow({ catalogVersionId: null, action: 'hub.session.signed_in', requestId: null }),
        )
        .mockResolvedValueOnce(
          detailRow({ catalogVersionId: null, action: 'something.else', requestId: null }),
        )
        .mockResolvedValueOnce(detailRow({ requestId: null }));
      prisma.catalogAction.findUnique.mockResolvedValueOnce(null);

      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        catalog: { description: 'Signed in to Audit Hub.', tags: ['auth.sign_in'] },
      });
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        catalog: { description: null, tags: [] },
      });
      // A catalog version without the action: nothing to describe it with.
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        catalog: { description: null, tags: [] },
      });
      expect(prisma.catalogAction.findUnique).toHaveBeenCalledTimes(1);
    });

    it('counts a verification of every application, and none that does not cover the event', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValue(detailRow({ requestId: null }));
      prisma.integritySeal.findFirst.mockResolvedValue({
        sealNo: 7n,
        createdAt: minus(100),
        sealHash: Buffer.alloc(32, 2),
        signature: Buffer.from('signature'),
        keyId: 'key-1',
      });
      prisma.integrityVerification.findMany
        .mockResolvedValueOnce([{ scope: null, finishedAt: minus(30) }])
        .mockResolvedValueOnce([{ scope: {}, finishedAt: minus(40) }])
        .mockResolvedValueOnce([{ scope: { appId: OTHER }, finishedAt: minus(50) }])
        .mockResolvedValueOnce([]);
      const integrity = async () => (await service.detail(ADMIN, id(1), REQ)).integrity;
      await expect(integrity()).resolves.toMatchObject({
        sealed: true,
        sealNo: '7',
        verifiedAt: minus(30).toISOString(),
      });
      await expect(integrity()).resolves.toMatchObject({ verifiedAt: minus(40).toISOString() });
      await expect(integrity()).resolves.toMatchObject({
        sealed: true,
        sealNo: '7',
        verifiedAt: null,
      });
      await expect(integrity()).resolves.toMatchObject({ verifiedAt: null });
    });

    it('says since when the actor of the event is blocked after an erasure', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValueOnce(detailRow({ requestId: null }));
      blockedIn(prisma, { 'user-7': [APP] });
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        blockedSince: BLOCKED_AT.toISOString(),
      });
      // The actor only: the event is about no user.
      expect(prisma.$queryRaw.mock.calls.map(lookupOf)).toEqual([['user-7', APP, APP]]);
    });

    it('says nothing of a block for what occurred after the last erasure (an account that stays)', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValueOnce(
        detailRow({ requestId: null, occurredAt: NOW }),
      );
      blockedIn(prisma, { 'user-7': [APP] });
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        blockedSince: null,
      });
    });

    it('says since when the user the event is about is blocked, in its application only', async () => {
      const { prisma, service } = setup();
      const about = (actorId: string | null, user: string) =>
        detailRow({ requestId: null, actorId, resourceType: 'user', resourceId: user });
      prisma.auditEvent.findUnique
        .mockResolvedValueOnce(about('admin-1', 'user-7'))
        .mockResolvedValueOnce(about(null, 'user-8'));
      blockedIn(prisma, { 'user-7': [APP], 'user-8': [OTHER] });
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        blockedSince: BLOCKED_AT.toISOString(),
      });
      expect(prisma.$queryRaw.mock.calls.map(lookupOf)).toEqual([
        ['admin-1', APP, APP],
        ['user-7', APP, APP],
      ]);
      // Blocked in another application only: not in this one.
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        blockedSince: null,
      });
      expect(lookupOf(prisma.$queryRaw.mock.calls[2])).toEqual(['user-8', APP, APP]);
    });

    it('looks nothing up for an event without an actor id and about no user', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValueOnce(
        detailRow({ requestId: null, actorId: null, resourceType: 'user', resourceId: null }),
      );
      await expect(service.detail(ADMIN, id(1), REQ)).resolves.toMatchObject({
        blockedSince: null,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("answers 404 alike for an unknown event and another application's", async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.auditEvent.findUnique.mockResolvedValueOnce(null);
      await expect(service.detail(ADMIN, id(1), REQ)).rejects.toThrow(NotFoundException);
      prisma.auditEvent.findUnique.mockResolvedValueOnce(detailRow({ appId: OTHER }));
      await expect(service.detail(AUDITOR, id(1), REQ)).rejects.toThrow('Event not found');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(hubAudit.record).not.toHaveBeenCalled();
    });
  });

  describe('subject', () => {
    it('gathers what a user did and what was done to them, with a summary (360°)', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce([
        summaryRow(1),
        summaryRow(2),
        summaryRow(3),
      ]);
      const activity = await service.subject(AUDITOR, APP, 'user-7', { limit: 2 }, REQ);

      const own = {
        appId: APP,
        OR: [{ actorId: 'user-7' }, { resourceType: 'user', resourceId: 'user-7' }],
      };
      expect(prisma.connectedApp.findUnique).toHaveBeenCalledWith({
        where: { id: APP },
        select: { id: true, correlationEnabled: true },
      });
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: { AND: [own, {}] },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: SUMMARY_SELECT,
      });
      expect(prisma.auditEvent.aggregate).toHaveBeenCalledWith({
        where: own,
        _min: { recordedAt: true },
        _max: { recordedAt: true },
      });
      expect(prisma.actorProfile.findUnique).toHaveBeenCalledWith({
        where: { appId_actorId: { appId: APP, actorId: 'user-7' } },
        select: { lastSignInAt: true },
      });
      expect(prisma.actorDevice.count).toHaveBeenCalledWith({
        where: { appId: APP, actorId: 'user-7' },
      });
      expect(prisma.actorCountry.findMany).toHaveBeenCalledWith({
        where: { appId: APP, actorId: 'user-7' },
        orderBy: { lastSeenAt: 'desc' },
        select: { country: true },
      });
      expect(prisma.alert.count).toHaveBeenCalledWith({
        where: { appId: APP, subject: 'user-7', status: { in: ['open', 'in_review'] } },
      });
      expect(lookupOf(prisma.$queryRaw.mock.calls[0])).toEqual(['user-7', APP, APP]);
      expect(activity).toEqual({
        subject: 'user-7',
        appId: APP,
        blockedSince: null,
        blockedThrough: null,
        summary: {
          firstSeenAt: minus(90).toISOString(),
          lastSeenAt: minus(1).toISOString(),
          lastSignInAt: minus(5).toISOString(),
          devices: 2,
          countries: ['ES', 'PT'],
          openAlerts: 1,
          otherApps: [],
        },
        events: { items: [summaryOf(1), summaryOf(2)], nextCursor: expect.any(String) as string },
      });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.subject.viewed',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        resource: { type: 'app_user', id: 'user-7' },
        details: { appId: APP, acrossApps: false },
        request: REQ,
      });
    });

    it('answers null for a subject never seen or never signed in', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.aggregate.mockResolvedValue({
        _min: { recordedAt: null },
        _max: { recordedAt: null },
      });
      prisma.actorProfile.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ lastSignInAt: null });
      for (let i = 0; i < 2; i += 1) {
        const { summary } = await service.subject(AUDITOR, APP, 'user-7', { limit: 50 }, REQ);
        expect(summary).toMatchObject({ firstSeenAt: null, lastSeenAt: null, lastSignInAt: null });
      }
    });

    it('stays in the application when correlation is off, even when asked across applications', async () => {
      const { prisma, hubAudit, service } = setup();
      await service.subject(AUDITOR, APP, 'user-7', { limit: 50, acrossApps: true }, REQ);
      // Only the page: no look for the same person elsewhere.
      expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.connectedApp.findMany).not.toHaveBeenCalled();
      expect(hubAudit.record.mock.calls[0]![0].details).toEqual({ appId: APP, acrossApps: false });
    });

    it('adds the same person in other visible applications with correlation on, by shared pseudonym', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.connectedApp.findUnique.mockResolvedValueOnce({ id: APP, correlationEnabled: true });
      // In QUIET, only a subject blocked there has the address.
      database(prisma, {
        pseudonyms: ['shared-1'],
        present: [OTHER],
        people: [{ appId: QUIET, subject: 'user-9', through: BLOCKED_THROUGH }],
      });
      prisma.connectedApp.findMany.mockResolvedValueOnce([
        { id: OTHER, slug: 'their-project' },
        { id: QUIET, slug: 'quiet-project' },
      ]);
      const activity = await service.subject(
        ADMIN,
        APP,
        'user-7',
        { limit: 50, acrossApps: true },
        REQ,
      );

      const calls = prisma.$queryRaw.mock.calls;
      const pseudonyms = calls.find((call) => sqlOf(call).includes('AS "pseudonym"'));
      expect(sqlOf(pseudonyms)).toContain('LIMIT 5');
      // Not blocked: from all of their events.
      expect(valuesOf(pseudonyms)).toEqual([APP, 'user-7', null, null]);
      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { correlationEnabled: true, system: false, id: { not: APP } },
        select: { id: true, slug: true },
      });
      const present = calls.find((call) => sqlOf(call).includes('unnest('));
      expect(valuesOf(present).slice(0, 2)).toEqual([[OTHER, QUIET], ['shared-1']]);
      const people = calls.find((call) => sqlOf(call).includes('r."subject", max(r."created_at")'));
      expect((valuesOf(people)[2] as Prisma.Sql).sql).toBe('"actor_email_hmac_shared"');
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [
          {
            OR: [
              {
                appId: APP,
                OR: [{ actorId: 'user-7' }, { resourceType: 'user', resourceId: 'user-7' }],
              },
              {
                AND: [
                  { appId: { in: [OTHER, QUIET] }, actorEmailHmacShared: { in: ['shared-1'] } },
                  {
                    NOT: {
                      OR: [
                        { appId: QUIET, actorId: 'user-9', occurredAt: { lte: BLOCKED_THROUGH } },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {},
        ],
      });
      // Only where they appear, unblocked.
      expect(activity.summary.otherApps).toEqual([{ appId: OTHER, slug: 'their-project' }]);
      expect(hubAudit.record.mock.calls[0]![0].details).toEqual({ appId: APP, acrossApps: true });
    });

    it("looks only in the caller's applications, and stays home when the person is nowhere else", async () => {
      const { prisma, service } = setup();
      prisma.connectedApp.findUnique.mockResolvedValue({ id: APP, correlationEnabled: true });
      database(prisma, { pseudonyms: ['shared-1'] });
      prisma.auditEvent.findMany.mockResolvedValueOnce([]);
      const query = { limit: 50, acrossApps: true };
      const first = await service.subject(AUDITOR, APP, 'user-7', query, REQ);
      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { correlationEnabled: true, system: false, id: { not: APP, in: [APP] } },
        select: { id: true, slug: true },
      });
      expect(first.summary.otherApps).toEqual([]);
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [expect.objectContaining({ appId: APP }), {}],
      });
      // No other application to look in: who appears where is not asked.
      expect(prisma.$queryRaw.mock.calls.some((call) => sqlOf(call).includes('unnest('))).toBe(
        false,
      );

      // No shared pseudonym at all: nothing else to look up.
      database(prisma, { pseudonyms: [] });
      prisma.auditEvent.findMany.mockResolvedValueOnce([]);
      const second = await service.subject(AUDITOR, APP, 'user-7', query, REQ);
      expect(second.summary.otherApps).toEqual([]);
      expect(prisma.connectedApp.findMany).toHaveBeenCalledTimes(1);
    });

    it('shows only what a blocked subject did after their last erasure, and records the view as blocked', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.connectedApp.findUnique.mockResolvedValueOnce({ id: APP, correlationEnabled: true });
      // An account that stays: they signed in again after the erasure.
      database(prisma, { blocked: { 'user-7': [APP] }, pseudonyms: ['shared-1'] });
      prisma.auditEvent.findMany.mockResolvedValueOnce([summaryRow(0)]);
      const query = { limit: 50, acrossApps: true };
      const activity = await service.subject(AUDITOR, APP, 'user-7', query, REQ);
      expect(activity).toMatchObject({
        blockedSince: BLOCKED_AT.toISOString(),
        blockedThrough: BLOCKED_THROUGH.toISOString(),
        events: { items: [summaryOf(0)] },
      });
      expect(lookupOf(prisma.$queryRaw.mock.calls[0])).toEqual(['user-7', APP, APP]);
      const after = { occurredAt: { gt: BLOCKED_THROUGH } };
      expect(prisma.auditEvent.aggregate).toHaveBeenCalledWith({
        where: {
          appId: APP,
          ...after,
          OR: [{ actorId: 'user-7' }, { resourceType: 'user', resourceId: 'user-7' }],
        },
        _min: { recordedAt: true },
        _max: { recordedAt: true },
      });
      expect(prisma.alert.count).toHaveBeenCalledWith({
        where: {
          appId: APP,
          subject: 'user-7',
          status: { in: ['open', 'in_review'] },
          createdAt: { gt: BLOCKED_THROUGH },
        },
      });
      // Elsewhere too, only from what they did after it.
      const pseudonyms = prisma.$queryRaw.mock.calls.find((call) =>
        sqlOf(call).includes('AS "pseudonym"'),
      );
      expect(valuesOf(pseudonyms)).toEqual([APP, 'user-7', BLOCKED_THROUGH, BLOCKED_THROUGH]);
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.subject.viewed',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        resource: { type: 'app_user', id: 'user-7' },
        details: { appId: APP, acrossApps: false, blocked: true },
        request: REQ,
      });
    });

    it('answers 404 alike for an unknown application and one the caller may not see', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.connectedApp.findUnique.mockResolvedValueOnce(null);
      await expect(service.subject(ADMIN, OTHER, 'user-7', { limit: 50 }, REQ)).rejects.toThrow(
        NotFoundException,
      );
      prisma.connectedApp.findUnique.mockResolvedValueOnce({ id: OTHER, correlationEnabled: true });
      await expect(service.subject(AUDITOR, OTHER, 'user-7', { limit: 50 }, REQ)).rejects.toThrow(
        'Application not found',
      );
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
      // Not even whether the subject is blocked there.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(hubAudit.record).not.toHaveBeenCalled();
    });
  });

  describe('resource', () => {
    it('keeps the resource filter on the pages after the first', async () => {
      const { prisma, service } = setup();
      const cursor = encodeCursor({ recordedAt: minus(3), id: id(3) });
      await service.resource(AUDITOR, APP, 'user', 'user-7', { cursor, limit: 50 }, REQ);
      const where = prisma.auditEvent.findMany.mock.calls[0]![0].where;
      // The cursor's position is an OR too: a spread would have dropped the resource's.
      expect(where).toEqual({
        AND: [
          {
            appId: APP,
            OR: [
              { resourceType: 'user', resourceId: 'user-7' },
              { parentResourceType: 'user', parentResourceId: 'user-7' },
            ],
          },
          { OR: [{ recordedAt: { lt: minus(3) } }, { recordedAt: minus(3), id: { lt: id(3) } }] },
        ],
      });
    });

    it('lists the events about a resource or about what it contains, and records the read', async () => {
      const { prisma, hubAudit, service } = setup();
      const page = await service.resource(AUDITOR, APP, 'user', 'user-7', { limit: 50 }, REQ);
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              appId: APP,
              OR: [
                { resourceType: 'user', resourceId: 'user-7' },
                { parentResourceType: 'user', parentResourceId: 'user-7' },
              ],
            },
            {},
          ],
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 51,
        select: SUMMARY_SELECT,
      });
      expect(page).toEqual({ items: [summaryOf(1)], nextCursor: null });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.resource.viewed',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        resource: { type: 'user', id: 'user-7' },
        details: { appId: APP, type: 'user' },
        request: REQ,
      });
    });

    it('answers 404 for an application the caller may not see', async () => {
      const { prisma, service } = setup();
      await expect(
        service.resource(MEMBER, APP, 'user', 'user-7', { limit: 50 }, REQ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('security', () => {
    it("sums an application's failed sign-ins by day, address, country and hour, with its open anomalies", async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const { prisma, hubAudit, service } = setup(true);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ day: '2026-10-14', count: 3 }])
        .mockResolvedValueOnce([{ ip: '203.0.113.7', count: 3, accounts: 1 }])
        .mockResolvedValueOnce([{ country: 'ES', count: 4 }])
        .mockResolvedValueOnce([{ dow: 2, hour: 9, count: 3 }]);
      prisma.alert.groupBy.mockResolvedValueOnce([
        { rule: 'brute_force_account', severity: 'high', _count: { _all: 2 } },
      ]);
      await expect(service.security(AUDITOR, APP, 7, REQ)).resolves.toEqual({
        appId: APP,
        days: 7,
        geolocation: true,
        failedSignIns: [{ day: '2026-10-14', count: 3 }],
        topIps: [{ ip: '203.0.113.7', count: 3, accounts: 1 }],
        topCountries: [{ country: 'ES', count: 4 }],
        heatmap: [{ dow: 2, hour: 9, count: 3 }],
        anomalies: [{ rule: 'brute_force_account', severity: 'high', open: 2 }],
      });

      const since = new Date(NOW.getTime() - 7 * DAY_MS);
      const calls = prisma.$queryRaw.mock.calls;
      expect(calls).toHaveLength(4);
      // An application's own failures come from its catalog's tags: no hub action names.
      for (const call of [calls[0], calls[1], calls[3]]) {
        expect(valuesOf(call).slice(0, 3)).toEqual([APP, since, []]);
        expect(valuesOf(call)[3]).toHaveProperty('sql');
      }
      expect(valuesOf(calls[2])).toEqual([APP, since, []]);
      expect(prisma.alert.groupBy).toHaveBeenCalledWith({
        by: ['rule', 'severity'],
        where: { appId: APP, status: { in: ['open', 'in_review'] } },
        _count: { _all: true },
        orderBy: { rule: 'asc' },
      });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.security.viewed',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        details: { appId: APP },
        request: REQ,
      });
    });

    it("counts Audit Hub's own sign-ins by its action names", async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const { prisma, service } = setup();
      prisma.connectedApp.findUnique.mockResolvedValueOnce({
        id: SYSTEM_APP_ID,
        correlationEnabled: false,
      });
      const overview = await service.security(ADMIN, SYSTEM_APP_ID, 1, REQ);
      expect(overview).toMatchObject({ appId: SYSTEM_APP_ID, days: 1, geolocation: false });
      const failed = hubActionsTagged('auth.sign_in_failed');
      const signIn = hubActionsTagged('auth.sign_in');
      expect(failed).toContain('hub.session.sign_in_failed');
      expect(signIn).toContain('hub.session.signed_in');
      const calls = prisma.$queryRaw.mock.calls;
      expect(valuesOf(calls[0])[2]).toEqual(failed);
      expect(valuesOf(calls[2])).toEqual([
        SYSTEM_APP_ID,
        new Date(NOW.getTime() - DAY_MS),
        [...signIn, ...failed],
      ]);
    });

    it('answers 404 for an application the caller may not see, querying nothing', async () => {
      const { prisma, service } = setup();
      await expect(service.security(AUDITOR, OTHER, 7, REQ)).rejects.toThrow(NotFoundException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('overview', () => {
    it('sums up every application an administrator sees, the last 24 hours oldest first', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const { prisma, service } = setup();
      prisma.connectedApp.findMany.mockResolvedValueOnce([
        { id: APP, slug: 'my-project', name: 'My project', status: 'active' },
        { id: OTHER, slug: 'their-project', name: 'Their project', status: 'suspended' },
        { id: QUIET, slug: 'quiet-project', name: 'Quiet project', status: 'active' },
      ]);
      prisma.auditEvent.groupBy
        .mockResolvedValueOnce([{ appId: APP, _count: { _all: 5 } }])
        .mockResolvedValueOnce([{ appId: APP, _count: { _all: 2 } }]);
      prisma.ingestException.groupBy.mockResolvedValueOnce([{ appId: APP, _count: { _all: 1 } }]);
      prisma.alert.groupBy.mockResolvedValueOnce([
        { appId: APP, severity: 'high', _count: { _all: 2 } },
        { appId: APP, severity: 'low', _count: { _all: 1 } },
        { appId: OTHER, severity: 'medium', _count: { _all: 4 } },
      ]);
      prisma.connectorInstance.groupBy.mockResolvedValueOnce([
        { appId: APP, _max: { lastHeartbeatAt: minus(30) }, _sum: { queueSize: 4 } },
        { appId: OTHER, _max: { lastHeartbeatAt: null }, _sum: { queueSize: null } },
      ]);
      prisma.sequenceGap.groupBy.mockResolvedValueOnce([{ appId: OTHER, _count: { _all: 1 } }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { appId: APP, hour: 0, count: 2 },
        { appId: APP, hour: 23, count: 1 },
        // Outside the 24 hours (a clock edge): left out.
        { appId: APP, hour: 24, count: 9 },
        { appId: APP, hour: -1, count: 9 },
        { appId: OTHER, hour: 5, count: 3 },
      ]);
      const overview = await service.overview(ADMIN);

      expect(prisma.connectedApp.findMany).toHaveBeenCalledWith({
        where: { system: false },
        orderBy: { name: 'asc' },
        select: { id: true, slug: true, name: true, status: true },
      });
      const ids = [APP, OTHER, QUIET];
      const since = new Date(NOW.getTime() - DAY_MS);
      expect(prisma.auditEvent.groupBy).toHaveBeenCalledWith({
        by: ['appId'],
        where: { appId: { in: ids }, recordedAt: { gte: since } },
        _count: { _all: true },
      });
      // High risk: a high severity's weight or more.
      expect(prisma.auditEvent.groupBy).toHaveBeenCalledWith({
        by: ['appId'],
        where: { appId: { in: ids }, recordedAt: { gte: since }, riskScore: { gte: 60 } },
        _count: { _all: true },
      });
      expect(prisma.ingestException.groupBy).toHaveBeenCalledWith({
        by: ['appId'],
        where: { appId: { in: ids }, kind: 'rejected', receivedAt: { gte: since } },
        _count: { _all: true },
      });
      expect(prisma.connectorInstance.groupBy).toHaveBeenCalledWith({
        by: ['appId'],
        where: { appId: { in: ids }, lastHeartbeatAt: { gte: since } },
        _max: { lastHeartbeatAt: true },
        _sum: { queueSize: true },
      });
      expect(prisma.sequenceGap.groupBy).toHaveBeenCalledWith({
        by: ['appId'],
        where: { appId: { in: ids }, closedAt: null },
        _count: { _all: true },
      });
      expect(valuesOf(prisma.$queryRaw.mock.calls[0])).toEqual([ids]);

      const trend = (hours: Record<number, number>) =>
        Array.from({ length: 24 }, (_, index) => hours[index] ?? 0);
      expect(overview.apps).toEqual([
        {
          appId: APP,
          slug: 'my-project',
          name: 'My project',
          status: 'active',
          events24h: 5,
          highRisk24h: 2,
          rejected24h: 1,
          openAlerts: { high: 2, low: 1 },
          lastHeartbeatAt: minus(30).toISOString(),
          queueSize: 4,
          openGaps: 0,
          trend: trend({ 0: 1, 23: 2 }),
        },
        {
          appId: OTHER,
          slug: 'their-project',
          name: 'Their project',
          status: 'suspended',
          events24h: 0,
          highRisk24h: 0,
          rejected24h: 0,
          openAlerts: { medium: 4 },
          lastHeartbeatAt: null,
          queueSize: 0,
          openGaps: 1,
          trend: trend({ 18: 3 }),
        },
        {
          appId: QUIET,
          slug: 'quiet-project',
          name: 'Quiet project',
          status: 'active',
          events24h: 0,
          highRisk24h: 0,
          rejected24h: 0,
          openAlerts: {},
          lastHeartbeatAt: null,
          queueSize: 0,
          openGaps: 0,
          trend: trend({}),
        },
      ]);
      // No verification yet.
      expect(overview.integrity).toBeNull();
      expect(overview.since).toBe(since.toISOString());
    });

    it("says the integrity of the log as the latest verification found it, for the caller's applications", async () => {
      const { prisma, service } = setup();
      // The auditor sees APP.
      prisma.connectedApp.findMany.mockResolvedValue([
        { id: APP, slug: 'my-project', name: 'My project', status: 'active' },
      ]);
      const run = (overrides: Record<string, unknown>) => ({
        outcome: 'passed',
        scope: {},
        failures: 0,
        failureSample: null,
        finishedAt: minus(60),
        ...overrides,
      });
      const failedElsewhere = run({
        outcome: 'failed',
        failures: 1,
        failureSample: [{ kind: 'seal_mismatch', appId: OTHER }],
      });
      const integrity = async (user: RequestUser, ...runs: Record<string, unknown>[]) => {
        prisma.integrityVerification.findMany.mockResolvedValueOnce(runs);
        return (await service.overview(user)).integrity;
      };
      // An administrator: the latest run, as it is.
      await expect(integrity(ADMIN, failedElsewhere)).resolves.toEqual({
        outcome: 'failed',
        finishedAt: minus(60).toISOString(),
      });
      expect(prisma.integrityVerification.findMany).toHaveBeenCalledWith({
        orderBy: { finishedAt: 'desc' },
        take: 20,
        select: {
          outcome: true,
          scope: true,
          failures: true,
          failureSample: true,
          finishedAt: true,
        },
      });
      // An auditor: a failure elsewhere, all of it known, is not theirs.
      await expect(integrity(AUDITOR, failedElsewhere)).resolves.toMatchObject({
        outcome: 'passed',
      });
      // A failure in their application, or one not all known, is.
      await expect(
        integrity(
          AUDITOR,
          run({ outcome: 'failed', failures: 1, failureSample: [{ appId: APP }] }),
        ),
      ).resolves.toMatchObject({ outcome: 'failed' });
      await expect(integrity(AUDITOR, { ...failedElsewhere, failures: 3 })).resolves.toMatchObject({
        outcome: 'failed',
      });
      await expect(integrity(AUDITOR, run({ outcome: 'error' }))).resolves.toMatchObject({
        outcome: 'error',
      });
      // A run of another application is skipped; none left: null.
      await expect(
        integrity(
          AUDITOR,
          run({ scope: { appId: OTHER }, outcome: 'failed', failures: 1 }),
          run({ scope: { appId: APP }, finishedAt: minus(120) }),
        ),
      ).resolves.toEqual({ outcome: 'passed', finishedAt: minus(120).toISOString() });
      await expect(integrity(AUDITOR, run({ scope: { appId: OTHER } }))).resolves.toBeNull();
    });

    it("lists only the caller's applications", async () => {
      const { prisma, service } = setup();
      await expect(service.overview(AUDITOR)).resolves.toMatchObject({ integrity: null, apps: [] });
      expect(prisma.connectedApp.findMany.mock.calls[0]![0].where).toEqual({
        system: false,
        id: { in: [APP] },
      });
    });
  });

  describe('summaries', () => {
    const STAFF = '0199e0b1-0000-7000-8000-0000000000f1';
    const viewed = HUB_ACTIONS['hub.event.viewed'].spec.description;

    it('says each action and actor in words, with one lookup of each kind for the whole page', async () => {
      const { prisma, service } = setup();
      prisma.catalogAction.findMany.mockResolvedValueOnce([
        {
          catalogVersionId: 'v1',
          action: 'auth.session.signed_in',
          description: 'A user signed in.',
        },
      ]);
      prisma.user.findMany.mockResolvedValueOnce([{ id: STAFF, name: 'Grace' }]);
      const hub = { appId: SYSTEM_APP_ID, action: 'hub.event.viewed', app: { slug: 'audit-hub' } };
      const rows = [
        summaryRow(1, { catalogVersionId: 'v1', personal: { actorLabel: 'Ada' } }),
        // The same catalog entry: looked up once.
        summaryRow(2, { catalogVersionId: 'v1' }),
        summaryRow(3, { ...hub, actorId: STAFF }),
        // Not an account's id: nothing to look up, no name.
        summaryRow(4, { ...hub, actorId: 'scheduler' }),
        summaryRow(5, { ...hub, actorType: 'system', actorId: null }),
      ] as unknown as Parameters<typeof service.summaries>[0];
      const items = await service.summaries(rows);
      expect(items.map((item) => [item.description, item.actor.label])).toEqual([
        ['A user signed in.', 'Ada'],
        ['A user signed in.', null],
        [viewed, 'Grace'],
        [viewed, null],
        [viewed, null],
      ]);
      expect(prisma.catalogAction.findMany).toHaveBeenCalledWith({
        where: { OR: [{ catalogVersionId: 'v1', action: 'auth.session.signed_in' }] },
        select: { catalogVersionId: true, action: true, description: true },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: [STAFF] } },
        select: { id: true, name: true },
      });
    });

    it('looks nothing up for a page with nothing to look up', async () => {
      const { prisma, service } = setup();
      await expect(service.summaries([])).resolves.toEqual([]);
      expect(prisma.catalogAction.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('toSummary', () => {
    it('names the resource only when both its type and its id are known', () => {
      const row = (overrides: Record<string, unknown>) =>
        summaryRow(1, overrides) as unknown as Parameters<typeof toSummary>[0];
      expect(toSummary(row({ resourceType: 'document', resourceId: 'doc-1' })).resource).toEqual({
        type: 'document',
        id: 'doc-1',
      });
      expect(toSummary(row({ resourceType: 'document' })).resource).toBeNull();
      expect(toSummary(row({ resourceId: 'doc-1' })).resource).toBeNull();
      expect(toSummary(row({ geoCountry: 'ES', httpStatus: 201 }))).toMatchObject({
        country: 'ES',
        httpStatus: 201,
      });
    });
  });

  it('pages any where in the explorer order (page)', async () => {
    const { prisma, service } = setup();
    const where: Prisma.AuditEventWhereInput = { appId: APP };
    await expect(service.page(where, 1)).resolves.toEqual({
      items: [summaryOf(1)],
      nextCursor: null,
    });
    expect(prisma.auditEvent.findMany.mock.calls[0]![0]).toMatchObject({ where, take: 2 });
  });
});
