import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertsService } from '../alerts/alerts.service.js';
import type { EnrichmentService } from '../enrichment/enrichment.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ResponseActionsService } from '../response-actions/response-actions.service.js';
import type { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import {
  deviceKeyOf,
  devicePlaceOf,
  ipPlaceOf,
  RealtimeRulesService,
  type RuleEvent,
} from './realtime-rules.service.js';
import { REALTIME_BATCH } from './rules.constants.js';

/** The SQL of a tagged-template call. */
const sqlOf = (call: unknown) => (call as [TemplateStringsArray])[0].join('?');

const APP = '0199e0b1-0000-7000-8000-000000000001';
const AT = new Date('2026-10-15T12:00:00.000Z');

function event(overrides: Partial<RuleEvent> = {}): RuleEvent {
  return {
    id: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
    appId: APP,
    eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f71',
    recordedAt: AT,
    occurredAt: AT,
    action: 'auth.session.signed_in',
    outcome: 'success',
    actorType: 'user',
    actorId: 'user-1',
    resourceType: null,
    resourceId: null,
    geoCountry: 'MX',
    geoAsn: 64500,
    ipScope: 'public',
    uaBrowser: 'Chrome',
    uaOs: 'Android',
    uaDeviceClass: 'mobile',
    clientType: 'android',
    deviceModel: 'Pixel 9',
    details: null,
    tags: ['auth.sign_in'],
    deviceId: 'device-aaaa-1111',
    geoCity: 'Mexico City',
    geoLatitude: 19.43,
    geoLongitude: -99.13,
    geoAccuracyKm: 10,
    deviceLatitude: null,
    deviceLongitude: null,
    deviceAccuracyM: null,
    ...overrides,
  };
}

function setup() {
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([] as unknown[])),
    actorProfile: {
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
      update: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    },
    actorDevice: {
      count: vi.fn(() => Promise.resolve(1)),
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    actorCountry: {
      count: vi.fn(() => Promise.resolve(1)),
      findUnique: vi.fn(() => Promise.resolve({ country: 'MX' } as unknown)),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    auditEvent: { findFirst: vi.fn(() => Promise.resolve(null as unknown)) },
    ruleCursor: {
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      upsert: vi.fn((_args: { create: Record<string, unknown> }) => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    $queryRaw: vi.fn(() => Promise.resolve([{ oldest: null, now: AT }] as unknown[])),
    ruleCursor: { findUnique: vi.fn(() => Promise.resolve(null as unknown)) },
  };
  const alerts = {
    raise: vi.fn((_tx: unknown, _input: { rule: string; severity: string; summary: unknown }) =>
      Promise.resolve({ id: 'alert-1', created: true }),
    ),
  };
  const webhooks = { toApp: vi.fn(() => Promise.resolve('delivery-1')) };
  const responseActions = { settle: vi.fn(() => Promise.resolve(true)) };
  const enrichment = { isHosting: vi.fn((asn: number | null) => asn === 64666) };
  const service = new RealtimeRulesService(
    prisma as unknown as PrismaService,
    alerts as unknown as AlertsService,
    webhooks as unknown as WebhookOutboxService,
    responseActions as unknown as ResponseActionsService,
    enrichment as unknown as EnrichmentService,
  );
  return { tx, prisma, alerts, webhooks, responseActions, service };
}

const rules = (alerts: ReturnType<typeof setup>['alerts']) =>
  alerts.raise.mock.calls.map(([, input]) => input.rule);

describe('RealtimeRulesService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sign-ins', () => {
    it('asks "was it you?" for a new device of a known account, and remembers it', async () => {
      const { tx, alerts, webhooks, service } = setup();
      await service.evaluate(tx as never, event());
      expect(rules(alerts)).toEqual(['suspicious_sign_in']);
      expect(alerts.raise.mock.calls[0]?.[1]).toMatchObject({
        severity: 'medium',
        // The device's families, never its id: what the panel explains it with.
        summary: {
          signals: ['new_device'],
          country: 'MX',
          clientType: 'android',
          deviceModel: 'Pixel 9',
        },
      });
      expect(alerts.raise.mock.calls[0]?.[1].summary).not.toHaveProperty('travelKm');
      expect(webhooks.toApp).toHaveBeenCalledWith(
        {
          appId: APP,
          type: 'security.sign_in_suspicious',
          data: {
            subject: 'user-1',
            eventId: event().eventId,
            occurredAt: AT.toISOString(),
            signals: ['new_device'],
            context: {
              country: 'MX',
              city: 'Mexico City',
              clientType: 'android',
              deviceModel: 'Pixel 9',
            },
          },
        },
        tx,
      );
      expect(tx.actorDevice.upsert).toHaveBeenCalled();
      expect(tx.actorCountry.upsert).toHaveBeenCalled();
      expect(tx.actorProfile.create.mock.calls[0]?.[0].data).toMatchObject({
        appId: APP,
        actorId: 'user-1',
        lastSeenAt: AT,
        lastSignInAt: AT,
        lastLatitude: '19.430',
        lastLongitude: '-99.130',
        lastAccuracyKm: 10,
      });
    });

    it('stays quiet for a known device, and for the first sign-in of an account', async () => {
      const known = setup();
      known.tx.actorDevice.findUnique.mockResolvedValue({ deviceKey: 'x' });
      await known.service.evaluate(known.tx as never, event());
      expect(known.alerts.raise).not.toHaveBeenCalled();
      const first = setup();
      first.tx.actorDevice.count.mockResolvedValue(0);
      first.tx.actorCountry.count.mockResolvedValue(0);
      first.tx.actorCountry.findUnique.mockResolvedValue(null);
      await first.service.evaluate(first.tx as never, event({ geoCountry: null }));
      expect(first.alerts.raise).not.toHaveBeenCalled();
      expect(first.webhooks.toApp).not.toHaveBeenCalled();
    });

    it('rates travel high, names a hosting IP, and tells a dormant account', async () => {
      const { tx, alerts, service } = setup();
      tx.actorDevice.findUnique.mockResolvedValue({ deviceKey: 'x' });
      tx.actorProfile.findUnique.mockResolvedValue({
        lastSeenAt: new Date(AT.getTime() - 100 * 86_400_000),
        lastLatitude: '40.416',
        lastLongitude: '-3.703',
        lastAccuracyKm: 10,
        lastLocationAt: new Date(AT.getTime() - 3_600_000),
      });
      await service.evaluate(tx as never, event({ geoAsn: 64666 }));
      expect(rules(alerts)).toEqual(['suspicious_sign_in', 'dormant_account']);
      expect(alerts.raise.mock.calls[0]?.[1]).toMatchObject({
        severity: 'high',
        summary: {
          signals: ['impossible_travel', 'hosting_ip'],
          travelKm: expect.any(Number) as unknown,
          travelMinutes: 60,
          travelSpeedKmh: expect.any(Number) as unknown,
        },
      });
      expect(alerts.raise.mock.calls[1]?.[1].summary).toMatchObject({ daysAway: 100 });
      expect(tx.actorProfile.update).toHaveBeenCalled();
    });

    it('finds a dormant account the rules forgot, from its last event', async () => {
      const { tx, alerts, service } = setup();
      tx.actorDevice.findUnique.mockResolvedValue({ deviceKey: 'x' });
      tx.auditEvent.findFirst.mockResolvedValue({
        recordedAt: new Date(AT.getTime() - 120 * 86_400_000),
      });
      await service.evaluate(
        tx as never,
        event({ geoCountry: null, deviceId: null, uaBrowser: null, uaOs: null }),
      );
      expect(rules(alerts)).toEqual(['dormant_account']);
      expect(tx.actorDevice.upsert).not.toHaveBeenCalled();
    });

    it('only remembers the activity of other events, and of users only', async () => {
      const { tx, alerts, service } = setup();
      await service.evaluate(
        tx as never,
        event({ tags: [], outcome: 'success', ipScope: 'private' }),
      );
      expect(alerts.raise).not.toHaveBeenCalled();
      expect(tx.actorProfile.create.mock.calls[0]?.[0].data).not.toHaveProperty('lastSignInAt');
      expect(tx.actorProfile.create.mock.calls[0]?.[0].data).not.toHaveProperty('lastLatitude');
      await service.evaluate(tx as never, event({ actorType: 'service', actorId: 'svc' }));
      await service.evaluate(tx as never, event({ actorId: null }));
      expect(tx.actorProfile.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('events that alert at once', () => {
    it('alerts on session reuse and on a privilege change', async () => {
      const { tx, alerts, service } = setup();
      tx.actorProfile.findUnique.mockResolvedValue({ lastSeenAt: AT, lastLatitude: null });
      await service.evaluate(tx as never, event({ tags: ['auth.session_reuse'] }));
      await service.evaluate(
        tx as never,
        event({ tags: ['iam.privilege_changed'], resourceType: 'user', resourceId: 'user-7' }),
      );
      await service.evaluate(tx as never, event({ tags: ['iam.privilege_changed'] }));
      await service.evaluate(
        tx as never,
        event({ tags: ['iam.privilege_changed'], outcome: 'denied' }),
      );
      expect(
        alerts.raise.mock.calls.map(([, input]) => [
          input.rule,
          (input as unknown as { subject: string }).subject,
        ]),
      ).toEqual([
        ['session_reuse', 'user-1'],
        ['privilege_change', 'user-7'],
        ['privilege_change', 'user-1'],
      ]);
    });
  });

  describe('a subject blocked after an erasure', () => {
    /** The erasure runs answer: each subject blocked through `through`; audit_erase_late erases. */
    function blocked(tx: ReturnType<typeof setup>['tx'], subjects: string[], through: Date) {
      tx.$queryRaw.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('audit_erase_late')) return Promise.resolve([{ erased: true }]);
        if (sql.includes('"erasure_runs"') && subjects.includes(values[0] as string)) {
          return Promise.resolve([{ appId: APP, since: through, through }]);
        }
        return Promise.resolve([]);
      }) as never);
    }
    const late = (tx: ReturnType<typeof setup>['tx']) =>
      tx.$queryRaw.mock.calls.filter((call) => sqlOf(call).includes('audit_erase_late'));

    it('drops the personal data of what a blocked actor did before, arrived late, and processes nothing of it', async () => {
      const { tx, alerts, service } = setup();
      blocked(tx, ['user-1'], AT);
      await service.evaluate(tx as never, event({ tags: ['auth.sign_in', 'auth.session_reuse'] }));
      expect(late(tx).map((call) => (call as unknown[])[1])).toEqual([
        '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
      ]);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        "Personal data of event 0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70 erased: it arrived after its subject's erasure",
      );
      expect(alerts.raise).not.toHaveBeenCalled();
      expect(tx.actorProfile.findUnique).not.toHaveBeenCalled();
      expect(tx.actorDevice.upsert).not.toHaveBeenCalled();
    });

    it('processes what a blocked actor does after their last erasure: an account that stays', async () => {
      const { tx, service } = setup();
      blocked(tx, ['user-1'], new Date(AT.getTime() - 1));
      await service.evaluate(tx as never, event());
      expect(late(tx)).toEqual([]);
      expect(tx.actorProfile.create).toHaveBeenCalledOnce();
    });

    it('drops the late personal data of an event about a blocked user, and still processes its actor', async () => {
      const { tx, service } = setup();
      blocked(tx, ['user-5'], AT);
      await service.evaluate(
        tx as never,
        event({ actorId: 'admin-1', resourceType: 'user', resourceId: 'user-5', tags: [] }),
      );
      expect(late(tx)).toHaveLength(1);
      expect(tx.actorProfile.create).toHaveBeenCalledOnce();
      // Nothing to drop: no log line.
      tx.$queryRaw.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) =>
        Promise.resolve(
          strings.join('?').includes('audit_erase_late')
            ? [{ erased: false }]
            : values[0] === 'user-5'
              ? [{ appId: APP, since: AT, through: AT }]
              : [],
        )) as never);
      vi.mocked(Logger.prototype.log).mockClear();
      await service.evaluate(
        tx as never,
        event({ actorId: 'admin-1', resourceType: 'user', resourceId: 'user-5', tags: [] }),
      );
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });
  });

  describe('erasure and response actions', () => {
    it("erases the deleted account's personal data, the resource's or else the actor's", async () => {
      const { tx, service } = setup();
      tx.$queryRaw.mockImplementation(((strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join('?').includes('audit_erase_subject')
            ? [{ personal_deleted: 2, location_deleted: 0, held: 0 }]
            : [],
        )) as never);
      await service.evaluate(
        tx as never,
        event({ tags: ['privacy.erasure_requested'], resourceType: 'user', resourceId: 'user-5' }),
      );
      await service.evaluate(tx as never, event({ tags: ['privacy.erasure_requested'] }));
      await service.evaluate(
        tx as never,
        event({ tags: ['privacy.erasure_requested'], outcome: 'failure' }),
      );
      await service.evaluate(
        tx as never,
        event({ tags: ['privacy.erasure_requested'], actorType: 'system', actorId: null }),
      );
      const subjects = tx.$queryRaw.mock.calls
        .filter((call) => sqlOf(call).includes('audit_erase_subject'))
        .map((call) => (call as unknown[])[2]);
      expect(subjects).toEqual(['user-5', 'user-1']);
    });

    it('settles a response action from its outcome event, ignoring malformed ones', async () => {
      const { tx, responseActions, service } = setup();
      const actionId = '0199e0b1-0000-7000-8000-0000000000c1';
      const outcome = (details: unknown) =>
        event({
          tags: ['response.executed'],
          actorType: 'system',
          actorId: null,
          details: details as RuleEvent['details'],
        });
      await service.evaluate(tx as never, outcome({ actionId, result: 'succeeded' }));
      for (const details of [
        null,
        { actionId },
        { actionId, result: 'maybe' },
        { actionId: 'x', result: 'failed' },
      ]) {
        await service.evaluate(tx as never, outcome(details));
      }
      expect(responseActions.settle).toHaveBeenCalledTimes(1);
      expect(responseActions.settle).toHaveBeenCalledWith(
        tx,
        APP,
        { actionId, result: 'succeeded' },
        event().id,
      );
    });
  });

  describe('the cursor', () => {
    it('reads batches until a short one, moves the cursor and reports the lag', async () => {
      const { tx, prisma, service } = setup();
      const full = Array.from({ length: REALTIME_BATCH }, (_, n) =>
        event({
          id: `0199e0b1-6a2c-7d9e-9f1a-${String(n).padStart(12, '0')}`,
          tags: [],
          actorType: 'system',
          actorId: null,
        }),
      );
      tx.$queryRaw
        .mockResolvedValueOnce([{ locked: true, horizon: AT }])
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([{ locked: true, horizon: AT }])
        .mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { oldest: new Date(AT.getTime() - 30_000), now: AT },
      ]);
      await expect(service.runOnce()).resolves.toBe(REALTIME_BATCH);
      expect(tx.ruleCursor.upsert.mock.calls[0]?.[0].create).toMatchObject({
        name: 'realtime',
        eventPk: full.at(-1)?.id,
      });
      expect((service as unknown as { lagSeconds: number }).lagSeconds).toBe(30);
    });

    it('leaves a batch to the instance holding the lock, and pauses on errors', async () => {
      vi.useFakeTimers();
      const { tx, prisma, service } = setup();
      tx.$queryRaw.mockResolvedValueOnce([{ locked: false, horizon: AT }]);
      await expect(service.runOnce()).resolves.toBe(0);
      expect(tx.ruleCursor.upsert).not.toHaveBeenCalled();
      prisma.$queryRaw.mockRejectedValueOnce(new Error('timeout'));
      tx.$queryRaw.mockResolvedValueOnce([{ locked: false, horizon: AT }]);
      await service.runOnce();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not read the rules' lag"),
      );
      service.onApplicationBootstrap();
      prisma.$transaction.mockRejectedValueOnce(new Error('database down'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('Real-time rules paused'),
      );
      service.onModuleDestroy();
    });
  });
});

describe('what the rules remember of a device and a place', () => {
  it('keys a device by its installation id, else by its user agent family', () => {
    const byId = deviceKeyOf(event());
    expect(byId).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceKeyOf(event({ deviceId: 'device-bbbb-2222' }))).not.toBe(byId);
    const byFamily = deviceKeyOf(event({ deviceId: null }));
    expect(byFamily).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceKeyOf(event({ deviceId: null, uaBrowser: null, uaOs: null }))).toBeNull();
    expect(deviceKeyOf(event({ appId: 'another' }))).not.toBe(byId);
  });

  it('places the IP when public, and the device by its reported location', () => {
    expect(ipPlaceOf(event())).toEqual({ latitude: 19.43, longitude: -99.13, accuracyKm: 10 });
    expect(ipPlaceOf(event({ ipScope: 'private' }))).toBeNull();
    expect(ipPlaceOf(event({ geoLatitude: null }))).toBeNull();
    expect(ipPlaceOf(event({ geoAccuracyKm: null }))?.accuracyKm).toBe(0);
    expect(devicePlaceOf(event())).toBeNull();
    expect(
      devicePlaceOf(
        event({ deviceLatitude: 19.43, deviceLongitude: -99.13, deviceAccuracyM: 5000 }),
      ),
    ).toEqual({
      latitude: 19.43,
      longitude: -99.13,
      accuracyKm: 6,
    });
    expect(devicePlaceOf(event({ deviceLatitude: 1, deviceLongitude: 2 }))?.accuracyKm).toBe(1);
  });
});
