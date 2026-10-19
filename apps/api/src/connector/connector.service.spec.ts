import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EnrichmentService } from '../enrichment/enrichment.service.js';
import { decodeCursor, encodeCursor } from '../explorer/cursor.js';
import type { HubAuditService, HubEventInput } from '../hub-audit/hub-audit.service.js';
import type { AuthenticatedApp } from '../ingest/ingest.types.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ConnectorService, GEOIP_ATTRIBUTION } from './connector.service.js';

const APP: AuthenticatedApp = {
  appId: '0199e0b1-0000-7000-8000-000000000001',
  slug: 'my-project',
  keyId: '0199e0b1-0000-7000-8000-0000000000c1',
};
const AT = new Date('2026-10-15T12:00:00.000Z');

const id = (n: number) => `0199e0b1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const minus = (n: number) => new Date(AT.getTime() - n * 1000);

const activityRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(n),
  eventId: id(1000 + n),
  recordedAt: minus(n),
  occurredAt: minus(n + 1),
  action: 'auth.session.signed_in',
  outcome: 'success',
  description: 'A user signed in.',
  clientType: 'web',
  os: 'Linux',
  deviceModel: 'Pixel 9',
  appVersion: '1.2.3',
  browser: 'Firefox',
  country: null,
  city: null,
  ...overrides,
});

const exportRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(n),
  eventId: id(1000 + n),
  recordedAt: minus(n),
  occurredAt: minus(n + 1),
  action: 'auth.session.signed_in',
  category: 'security',
  outcome: 'success',
  actorId: 'user-3',
  details: null,
  changeBefore: null,
  changeAfter: null,
  clientType: null,
  clientOs: null,
  clientDeviceModel: null,
  clientAppVersion: null,
  geoCountry: null,
  personal: null,
  location: null,
  ...overrides,
});

function setup(geolocation = false) {
  // The blocked lookup (explorer/blocked.ts): the subject's erasure runs, none by default.
  const blocked: { appId: string; since: Date; through: Date }[] = [];
  // Every other query: the activity's.
  const events = vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve([activityRow(1)] as unknown[]),
  );
  const prisma = {
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join('?').includes('"erasure_runs"')
        ? Promise.resolve(blocked as unknown[])
        : events(strings, ...values),
    ),
    auditEvent: {
      findMany: vi.fn((_args: unknown) => Promise.resolve([exportRow(1)] as unknown[])),
    },
  };
  const enrichment = { geolocation };
  const hubAudit = { record: vi.fn((_input: HubEventInput) => Promise.resolve('hub-event')) };
  const service = new ConnectorService(
    prisma as unknown as PrismaService,
    enrichment as unknown as EnrichmentService,
    hubAudit as unknown as HubAuditService,
  );
  return { prisma, events, blocked, hubAudit, service };
}

/** The values a tagged-template call passed (strings first, then values). */
const valuesOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) => call?.slice(1) ?? [];

describe('ConnectorService', () => {
  describe('activity', () => {
    it("lists the subject's user-visible actions, minimal fields, and records the read", async () => {
      const { prisma, events, hubAudit, service } = setup();
      const page = await service.activity(APP, 'user-3', { limit: 10 });
      expect(page).toEqual({
        items: [
          {
            eventId: id(1001),
            action: 'auth.session.signed_in',
            description: 'A user signed in.',
            outcome: 'success',
            occurredAt: minus(2).toISOString(),
            client: {
              type: 'web',
              os: 'Linux',
              deviceModel: 'Pixel 9',
              appVersion: '1.2.3',
              browser: 'Firefox',
            },
            location: {},
          },
        ],
      });
      // Blocked after an erasure in this application? Not this subject.
      expect(valuesOf(prisma.$queryRaw.mock.calls[0]).slice(0, 3)).toEqual([
        'user-3',
        APP.appId,
        APP.appId,
      ]);
      const values = valuesOf(events.mock.calls[0]);
      expect(values.slice(0, 3)).toEqual([APP.appId, 'user-3', 'user-3']);
      // The first page: no cursor condition; nothing blocked; one more row than asked for.
      expect((values[3] as Prisma.Sql).sql).toBe('TRUE');
      expect(values.slice(4, 6)).toEqual([null, null]);
      expect(values[6]).toBe(11);
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.connector.read',
        actor: { type: 'service', id: 'my-project' },
        resource: { type: 'app_user', id: 'user-3' },
        details: { appId: APP.appId, what: 'activity' },
      });
    });

    it('continues after a cursor and gives the next one when there is more', async () => {
      const { events, service } = setup();
      events.mockResolvedValueOnce([activityRow(4), activityRow(5), activityRow(6)]);
      const cursor = encodeCursor({ recordedAt: minus(3), id: id(3) });
      const page = await service.activity(APP, 'user-3', { cursor, limit: 2 });
      expect(page.items.map((item) => item.eventId)).toEqual([id(1004), id(1005)]);
      expect(decodeCursor(page.nextCursor)).toEqual({ recordedAt: minus(5), id: id(5) });
      const condition = valuesOf(events.mock.calls[0])[3] as Prisma.Sql;
      expect(condition.sql).toContain('< (?, ?::uuid)');
      expect(condition.values).toEqual([minus(3), id(3)]);
    });

    it('refuses a cursor it did not give (400), reading none of the events', async () => {
      const { prisma, events, hubAudit, service } = setup();
      await expect(service.activity(APP, 'user-3', { cursor: 'bogus', limit: 10 })).rejects.toThrow(
        BadRequestException,
      );
      // Refused before anything is read, whether the subject is blocked included.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(events).not.toHaveBeenCalled();
      expect(hubAudit.record).not.toHaveBeenCalled();
    });

    it('caps every text, leaves out what is unknown, and credits the geolocation it shows', async () => {
      const { events, service } = setup(true);
      events.mockResolvedValueOnce([
        activityRow(1, {
          description: 'd'.repeat(600),
          os: 'o'.repeat(40),
          deviceModel: 'm'.repeat(80),
          appVersion: 'v'.repeat(40),
          browser: 'b'.repeat(80),
          country: 'ES',
          city: 'c'.repeat(200),
        }),
        activityRow(2, {
          clientType: null,
          os: null,
          deviceModel: null,
          appVersion: null,
          browser: null,
        }),
      ]);
      const page = await service.activity(APP, 'user-3', { limit: 10 });
      expect(page.items[0]).toMatchObject({
        description: 'd'.repeat(500),
        client: {
          type: 'web',
          os: 'o'.repeat(32),
          deviceModel: 'm'.repeat(64),
          appVersion: 'v'.repeat(32),
          browser: 'b'.repeat(64),
        },
        location: { country: 'ES', city: 'c'.repeat(128) },
      });
      expect(page.items[1]?.client).toEqual({});
      expect(page.items[1]?.location).toEqual({});
      expect(page.attribution).toBe(GEOIP_ATTRIBUTION);
      expect(page).not.toHaveProperty('nextCursor');
    });

    it('credits no geolocation when no item has a country, or the database is off', async () => {
      const on = setup(true);
      await expect(on.service.activity(APP, 'user-3', { limit: 10 })).resolves.not.toHaveProperty(
        'attribution',
      );
      const off = setup(false);
      off.events.mockResolvedValueOnce([activityRow(1, { country: 'ES' })]);
      await expect(off.service.activity(APP, 'user-3', { limit: 10 })).resolves.not.toHaveProperty(
        'attribution',
      );
    });

    it('answers only what a blocked subject did after their last erasure, and still records the read', async () => {
      const { prisma, events, blocked, hubAudit, service } = setup(true);
      blocked.push({ appId: APP.appId, since: minus(7200), through: minus(3600) });
      // A deleted account: nothing after its erasure.
      events.mockResolvedValueOnce([]);
      await expect(service.activity(APP, 'user-3', { limit: 10 })).resolves.toEqual({ items: [] });
      expect(valuesOf(prisma.$queryRaw.mock.calls[0]).slice(0, 3)).toEqual([
        'user-3',
        APP.appId,
        APP.appId,
      ]);
      // Only what occurred after the last erasure.
      expect(valuesOf(events.mock.calls[0]).slice(4, 6)).toEqual([minus(3600), minus(3600)]);
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.connector.read',
        actor: { type: 'service', id: 'my-project' },
        resource: { type: 'app_user', id: 'user-3' },
        details: { appId: APP.appId, what: 'activity' },
      });
    });
  });

  describe('export', () => {
    it("pages through the subject's events as actor or resource, and records the read", async () => {
      const { prisma, hubAudit, service } = setup();
      const page = await service.export(APP, 'user-3');
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          appId: APP.appId,
          AND: [
            { OR: [{ actorId: 'user-3' }, { resourceType: 'user', resourceId: 'user-3' }] },
            {},
          ],
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 101,
        include: { personal: true, location: true },
      });
      expect(page).toEqual({
        items: [
          {
            eventId: id(1001),
            action: 'auth.session.signed_in',
            category: 'security',
            outcome: 'success',
            occurredAt: minus(2).toISOString(),
            recordedAt: minus(1).toISOString(),
            role: 'actor',
            client: {},
            network: {},
          },
        ],
      });
      expect(hubAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ details: { appId: APP.appId, what: 'export' } }),
      );
      expect(valuesOf(prisma.$queryRaw.mock.calls[0]).slice(0, 3)).toEqual([
        'user-3',
        APP.appId,
        APP.appId,
      ]);
    });

    it('refuses a cursor it did not give (400) before anything is read', async () => {
      const { prisma, hubAudit, service } = setup();
      await expect(service.export(APP, 'user-3', 'bogus')).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
      expect(hubAudit.record).not.toHaveBeenCalled();
    });

    it('exports only what a blocked subject did after their last erasure, and still records the read', async () => {
      const { prisma, blocked, hubAudit, service } = setup(true);
      blocked.push({ appId: APP.appId, since: minus(7200), through: minus(3600) });
      prisma.auditEvent.findMany.mockResolvedValueOnce([]);
      const cursor = encodeCursor({ recordedAt: minus(0), id: id(0) });
      // A deleted account: nothing after its erasure.
      await expect(service.export(APP, 'user-3', cursor)).resolves.toEqual({
        items: [],
        attribution: GEOIP_ATTRIBUTION,
      });
      expect(valuesOf(prisma.$queryRaw.mock.calls[0]).slice(0, 3)).toEqual([
        'user-3',
        APP.appId,
        APP.appId,
      ]);
      expect(prisma.auditEvent.findMany.mock.calls[0]![0]).toMatchObject({
        where: { appId: APP.appId, occurredAt: { gt: minus(3600) } },
      });
      expect(hubAudit.record).toHaveBeenCalledWith({
        action: 'hub.connector.read',
        actor: { type: 'service', id: 'my-project' },
        resource: { type: 'app_user', id: 'user-3' },
        details: { appId: APP.appId, what: 'export' },
      });
    });

    it('includes what is still kept: details, the change, the client, the network and the location', async () => {
      const { prisma, service } = setup(true);
      prisma.auditEvent.findMany.mockResolvedValueOnce([
        exportRow(1, {
          actorId: 'admin-1',
          details: { field: 'email' },
          changeBefore: { email: 'old@example.com' },
          changeAfter: { email: 'new@example.com' },
          clientType: 'android',
          clientOs: 'o'.repeat(40),
          clientDeviceModel: 'm'.repeat(80),
          clientAppVersion: 'v'.repeat(40),
          geoCountry: 'ES',
          personal: { ip: '203.0.113.7', userAgent: 'u'.repeat(1100), geoCity: 'c'.repeat(200) },
          location: { latitude: '40.4168', longitude: '-3.7038', capturedAt: AT },
        }),
        exportRow(2, { changeAfter: { email: 'new@example.com' } }),
        exportRow(3, { personal: { ip: null, userAgent: null, geoCity: null } }),
      ]);
      const page = await service.export(APP, 'user-3');
      expect(page.items[0]).toEqual({
        eventId: id(1001),
        action: 'auth.session.signed_in',
        category: 'security',
        outcome: 'success',
        occurredAt: minus(2).toISOString(),
        recordedAt: minus(1).toISOString(),
        role: 'resource',
        details: { field: 'email' },
        change: { before: { email: 'old@example.com' }, after: { email: 'new@example.com' } },
        client: {
          type: 'android',
          os: 'o'.repeat(32),
          deviceModel: 'm'.repeat(64),
          appVersion: 'v'.repeat(32),
        },
        network: {
          ip: '203.0.113.7',
          userAgent: 'u'.repeat(1024),
          country: 'ES',
          city: 'c'.repeat(128),
        },
        location: { latitude: 40.4168, longitude: -3.7038, capturedAt: AT.toISOString() },
      });
      expect(page.items[1]?.change).toEqual({ after: { email: 'new@example.com' } });
      expect(page.items[2]?.network).toEqual({});
      // The export always credits the geolocation when the database is on.
      expect(page.attribution).toBe(GEOIP_ATTRIBUTION);
    });

    it('continues after a cursor, a hundred events a page', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce(
        Array.from({ length: 101 }, (_, n) => exportRow(n + 1)),
      );
      const cursor = encodeCursor({ recordedAt: minus(0), id: id(0) });
      const page = await service.export(APP, 'user-3', cursor);
      expect(page.items).toHaveLength(100);
      expect(decodeCursor(page.nextCursor)).toEqual({ recordedAt: minus(100), id: id(100) });
      const args = prisma.auditEvent.findMany.mock.calls[0]![0] as {
        where: { AND: unknown[] };
      };
      expect(args.where.AND[1]).toEqual({
        OR: [{ recordedAt: { lt: minus(0) } }, { recordedAt: minus(0), id: { lt: id(0) } }],
      });
    });
  });
});
