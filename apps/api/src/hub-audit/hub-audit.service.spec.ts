import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConnectedAppsService,
  SYSTEM_APP_ID,
} from '../connected-apps/connected-apps.service.js';
import type { EnrichmentService } from '../enrichment/enrichment.service.js';
import { buildRows, contentHashOf, type EventRow } from '../ingest/event-rows.js';
import { runWithRequestContext } from '../observability/request-context.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HubAuditService } from './hub-audit.service.js';

// The real normalization, rows and hashes (event-rows.ts); buildRows is
// wrapped only to observe it and, once, to refuse an event, which no action of
// hub-actions.ts can trigger. The SQL (the timeout, the clock, the streams)
// runs in the integration suites.
vi.mock('../ingest/event-rows.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ingest/event-rows.js')>();
  return { ...actual, buildRows: vi.fn(actual.buildRows) };
});

const AT = new Date('2026-10-15T12:00:00.000Z');
const ADMIN = '0199e0b1-0000-7000-8000-00000000000a';
const USER = '0199e0b1-0000-7000-8000-00000000000b';
const APP = '0199e0b1-0000-7000-8000-000000000001';

type Data = Record<string, unknown>;

function setup(enrichment?: Pick<EnrichmentService, 'enrich'>) {
  const tx = {
    $executeRaw: vi.fn(() => Promise.resolve(0)),
    $queryRaw: vi.fn(() => Promise.resolve([{ now: AT }] as unknown[])),
    auditEvent: { create: vi.fn((_args: { data: Data }) => Promise.resolve({})) },
    eventPersonal: { create: vi.fn((_args: { data: Data }) => Promise.resolve({})) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const apps = { ensureSystemApp: vi.fn(() => Promise.resolve()) };
  const service = new HubAuditService(
    prisma as unknown as PrismaService,
    apps as unknown as ConnectedAppsService,
    enrichment as EnrichmentService | undefined,
  );
  const stored = (call = 0) => tx.auditEvent.create.mock.calls[call]?.[0].data ?? {};
  const personal = (call = 0) => tx.eventPersonal.create.mock.calls[call]?.[0].data ?? {};
  return { tx, prisma, apps, service, stored, personal };
}

function request(
  overrides: Partial<Record<keyof Request, unknown>> = {},
  extraHeaders: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
    ...extraHeaders,
  };
  return {
    method: 'POST',
    ip: '::ffff:203.0.113.7',
    route: { path: '/api/auth/sign-in' },
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  } as unknown as Request;
}

const foreignKeyError = (meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
    code: 'P2003',
    clientVersion: 'test',
    ...(meta === undefined ? {} : { meta }),
  });
const MISSING_APP = { modelName: 'AuditEvent', field_name: 'audit_events_app_id_fkey (index)' };

// The row as built, before Prisma's null markers: what the content hash covers.
const rowOf = (data: Data) =>
  ({
    ...data,
    changeBefore: data.changeBefore === Prisma.DbNull ? null : data.changeBefore,
    changeAfter: data.changeAfter === Prisma.DbNull ? null : data.changeAfter,
    details: data.details === Prisma.DbNull ? null : data.details,
  }) as unknown as EventRow;

describe('HubAuditService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('record', () => {
    it("stores a person's event as the system application's, in its own transaction", async () => {
      const { tx, service, stored, personal } = setup();
      const id = await runWithRequestContext({ requestId: 'req-1' }, () =>
        service.record({
          action: 'hub.session.signed_in',
          actor: { type: 'user', id: USER, role: 'auditor' },
          details: { method: 'totp' },
          request: request(),
        }),
      );

      expect(tx.$executeRaw).toHaveBeenCalledOnce();
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      const row = stored();
      expect(id).toBe(row.id);
      expect(row).toMatchObject({
        appId: SYSTEM_APP_ID,
        // Audit Hub's own: no sequence, no published catalog.
        sequenceEpoch: null,
        sourceSeq: null,
        catalogVersionId: null,
        connectorName: 'audit-hub',
        connectorVersion: '0.1.0',
        schemaVersion: 1,
        category: 'security',
        action: 'hub.session.signed_in',
        outcome: 'success',
        severity: 'info',
        actorType: 'user',
        actorId: USER,
        actorRole: 'auditor',
        occurredAt: AT,
        recordedAt: AT,
        requestId: 'req-1',
        httpMethod: 'POST',
        httpRoute: '/api/auth/sign-in',
        details: { method: 'totp' },
        // No change: the database's NULL, not JSON null.
        changeBefore: Prisma.DbNull,
        changeAfter: Prisma.DbNull,
      });
      expect(row.eventId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));

      // The hash covers the row as stored (no sequence), not the one buildRows hashed.
      const built = vi.mocked(buildRows).mock.results[0]?.value as { event: EventRow };
      expect(row.contentHash).toEqual(contentHashOf(rowOf(row)));
      expect(row.contentHash).not.toEqual(built.event.contentHash);

      // The caller's address and browser go to the personal row, kept for less time.
      expect(tx.eventPersonal.create).toHaveBeenCalledOnce();
      expect(personal()).toMatchObject({
        eventPk: id,
        appId: SYSTEM_APP_ID,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        personalChange: Prisma.DbNull,
      });
      expect(row.personalDigest).toBeInstanceOf(Uint8Array);
    });

    it("enriches the request as an application's event at ingest: browser, system, device, place", async () => {
      const enrich = vi.fn(() => ({
        uaBrowser: 'Firefox',
        uaOs: 'Linux',
        uaDeviceClass: 'desktop',
        geoCountry: 'MX',
        geoCity: 'Monterrey',
      }));
      const { service, stored, personal } = setup({ enrich });
      await service.record({
        action: 'hub.session.signed_in',
        actor: { type: 'user', id: USER, role: 'auditor' },
        details: { method: 'totp' },
        request: request(),
      });
      expect(enrich).toHaveBeenCalledWith(
        expect.objectContaining({
          network: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
        }),
      );
      expect(stored()).toMatchObject({
        uaBrowser: 'Firefox',
        uaOs: 'Linux',
        uaDeviceClass: 'desktop',
        geoCountry: 'MX',
      });
      expect(personal()).toMatchObject({ geoCity: 'Monterrey' });
      // Without it (the CLIs, which have no request), nothing is derived.
      const bare = setup();
      await bare.service.record({
        action: 'hub.session.signed_in',
        actor: { type: 'user', id: USER, role: 'auditor' },
        details: { method: 'totp' },
        request: request(),
      });
      expect(bare.stored()).toMatchObject({ uaBrowser: null, uaOs: null, geoCountry: null });
    });

    it("keeps what the panel's browser says of itself in its client hints", async () => {
      const { service, personal } = setup();
      await service.record({
        action: 'hub.session.signed_in',
        actor: { type: 'user', id: USER, role: 'auditor' },
        details: { method: 'totp' },
        request: request(
          {},
          {
            'sec-ch-ua': '"Microsoft Edge";v="155", "Chromium";v="155", "Not.A/Brand";v="99"',
            'sec-ch-ua-platform': '"Linux"',
            'sec-ch-ua-mobile': '?0',
          },
        ),
      });
      expect(personal()).toMatchObject({
        clientHints: {
          brands: [
            { brand: 'Microsoft Edge', version: '155' },
            { brand: 'Chromium', version: '155' },
          ],
          platform: 'Linux',
          mobile: false,
        },
      });
    });

    it('stores what people look at in audit_access, validated as audit', async () => {
      const { service, stored } = setup();
      await service.record({
        action: 'hub.events.searched',
        actor: { type: 'user', id: ADMIN, role: 'admin' },
        details: { appId: APP, filters: ['action', 'actor'], results: 3 },
      });
      expect(vi.mocked(buildRows).mock.calls[0]?.[0].spec.category).toBe('audit');
      expect(stored()).toMatchObject({
        category: 'audit_access',
        details: { appId: APP, filters: ['action', 'actor'], results: 3 },
      });
    });

    it('keeps the outcome, the reason, the resource and the change it is given', async () => {
      const { service, stored } = setup();
      await service.record({
        action: 'hub.user.role_changed',
        actor: { type: 'user', id: ADMIN, role: 'admin' },
        outcome: 'failure',
        reason: 'last_admin',
        resource: { type: 'user', id: USER },
        change: { before: { role: 'admin' }, after: { role: 'member' } },
      });
      const row = stored();
      expect(row).toMatchObject({
        category: 'audit',
        severity: 'high',
        outcome: 'failure',
        reason: 'last_admin',
        resourceType: 'user',
        resourceId: USER,
        changeBefore: { role: 'admin' },
        changeAfter: { role: 'member' },
        details: Prisma.DbNull,
      });
      expect(row.contentHash).toEqual(contentHashOf(rowOf(row)));
    });

    it('records a connected application as a service, and no personal row without a request', async () => {
      const { tx, service, stored } = setup();
      await service.record({
        action: 'hub.connector.read',
        actor: { type: 'service', id: 'my-project' },
        resource: { type: 'app_user', id: 'user-9' },
        details: { appId: APP, what: 'export' },
      });
      expect(stored()).toMatchObject({
        actorType: 'service',
        actorId: 'my-project',
        actorRole: null,
        requestId: null,
        httpMethod: null,
        httpRoute: null,
        personalDigest: null,
      });
      expect(tx.eventPersonal.create).not.toHaveBeenCalled();
    });

    it('records an anonymous caller without an id', async () => {
      const { service, stored } = setup();
      await service.record({
        action: 'hub.session.sign_in_failed',
        actor: { type: 'anonymous' },
        outcome: 'failure',
        details: { stage: 'password' },
      });
      expect(stored()).toMatchObject({ actorType: 'anonymous', actorId: null, actorRole: null });
    });

    it('leaves out what the request does not tell: no address, no browser, no route, no request id', async () => {
      const { tx, service, stored } = setup();
      await service.record({
        action: 'hub.session.stepped_up',
        actor: { type: 'user', id: USER, role: 'member' },
        request: request({ ip: undefined, route: undefined, get: () => undefined }),
      });
      expect(stored()).toMatchObject({
        httpMethod: 'POST',
        httpRoute: null,
        requestId: null,
        personalDigest: null,
      });
      expect(tx.eventPersonal.create).not.toHaveBeenCalled();
    });

    it('cuts an oversized route and user agent instead of losing them', async () => {
      const { service, stored, personal } = setup();
      const route = `/${'a'.repeat(299)}`;
      const userAgent = 'b'.repeat(600);
      await service.record({
        action: 'hub.session.stepped_up',
        actor: { type: 'user', id: USER, role: 'member' },
        request: request({
          ip: '2001:db8::1',
          route: { path: route },
          get: (name: string) => (name === 'User-Agent' ? userAgent : undefined),
        }),
      });
      expect(stored().httpRoute).toBe(route.slice(0, 256));
      expect(personal()).toMatchObject({ ip: '2001:db8::1', userAgent: userAgent.slice(0, 512) });
    });

    it('ignores a route that is not a path', async () => {
      const { service, stored } = setup();
      await service.record({
        action: 'hub.session.stepped_up',
        actor: { type: 'user', id: USER, role: 'member' },
        request: request({ route: { path: /^\/regex$/ } }),
      });
      expect(stored().httpRoute).toBeNull();
    });

    it("uses the process clock when the database's answers none", async () => {
      vi.useFakeTimers({ now: AT, toFake: ['Date'] });
      const { tx, service, stored } = setup();
      tx.$queryRaw.mockResolvedValueOnce([]);
      await service.record({
        action: 'hub.session.stepped_up',
        actor: { type: 'user', id: USER, role: 'member' },
      });
      expect(stored()).toMatchObject({ recordedAt: AT, occurredAt: AT });
    });

    it('refuses an event the normalization rejects, storing nothing', async () => {
      const { tx, service } = setup();
      await expect(
        service.record({
          action: 'hub.session.signed_in',
          actor: { type: 'user', id: '', role: 'x' },
        }),
      ).rejects.toThrow('hub.session.signed_in is not a valid event: schema_invalid (actor.id)');
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    });

    it('refuses an event its spec rejects, storing nothing', async () => {
      const { tx, service } = setup();
      vi.mocked(buildRows).mockReturnValueOnce({
        status: 'rejected',
        reason: 'details_invalid',
        paths: ['details.method', 'details.stage'],
      });
      await expect(
        service.record({
          action: 'hub.session.signed_in',
          actor: { type: 'user', id: USER, role: 'member' },
        }),
      ).rejects.toThrow(
        'hub.session.signed_in does not follow its spec: details_invalid (details.method, details.stage)',
      );
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    });

    it('brings the system application back once when its row is missing, then writes again', async () => {
      const { tx, apps, service, stored } = setup();
      tx.auditEvent.create.mockRejectedValueOnce(foreignKeyError(MISSING_APP));
      const id = await service.record({
        action: 'hub.session.stepped_up',
        actor: { type: 'user', id: USER, role: 'member' },
      });
      expect(apps.ensureSystemApp).toHaveBeenCalledOnce();
      expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
      // A new event: a new id, the one answered.
      expect(id).toBe(stored(1).id);
      expect(stored(1).id).not.toBe(stored(0).id);
    });

    it('tries only once more: a second failure reaches the caller', async () => {
      const { tx, apps, service } = setup();
      tx.auditEvent.create.mockRejectedValue(foreignKeyError(MISSING_APP));
      await expect(
        service.record({
          action: 'hub.session.stepped_up',
          actor: { type: 'user', id: USER, role: 'member' },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
      expect(apps.ensureSystemApp).toHaveBeenCalledOnce();
      expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['a foreign key of another column', foreignKeyError({ field_name: 'user_id' })],
      ['a foreign key error without details', foreignKeyError()],
      [
        'another database error',
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: MISSING_APP,
        }),
      ],
      ['an error that is not the database', new Error('connection reset')],
    ])('rethrows %s without touching the system application', async (_case, error) => {
      const { tx, apps, service } = setup();
      tx.auditEvent.create.mockRejectedValueOnce(error);
      await expect(
        service.record({
          action: 'hub.session.stepped_up',
          actor: { type: 'user', id: USER, role: 'member' },
        }),
      ).rejects.toBe(error);
      expect(apps.ensureSystemApp).not.toHaveBeenCalled();
      expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    });
  });

  describe('recordQuietly', () => {
    it('records like record', async () => {
      const { tx, service } = setup();
      await expect(
        service.recordQuietly({
          action: 'hub.mfa.enrolled',
          actor: { type: 'user', id: USER, role: 'member' },
        }),
      ).resolves.toBeUndefined();
      expect(tx.auditEvent.create).toHaveBeenCalledOnce();
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    it('logs a failure by class and code instead of failing what was already done', async () => {
      const { tx, service } = setup();
      tx.auditEvent.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on user@example.com', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.recordQuietly({
          action: 'hub.mfa.reset',
          actor: { type: 'user', id: ADMIN, role: 'admin' },
          resource: { type: 'user', id: USER },
          details: { reason: 'Lost their phone' },
        }),
      ).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Could not record hub.mfa.reset: PrismaClientKnownRequestError P2002',
      );
      expect(JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls)).not.toContain(
        'user@example.com',
      );
    });
  });
});
