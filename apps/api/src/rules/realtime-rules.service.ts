import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { errorSummary } from '../common/logging/error-summary.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { hubTagsOf } from '../hub-audit/hub-actions.js';
import { observeRulesLag } from '../observability/metrics.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESULTS, ResponseActionsService } from '../response-actions/response-actions.service.js';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import type { Place } from './geo.js';
import { REALTIME_BATCH, REALTIME_HORIZON_MS, REALTIME_INTERVAL_MS } from './rules.constants.js';
import { signInSeverity, signInSignals } from './sign-in-signals.js';
import { blockOf, isBlocked } from '../explorer/blocked.js';

export const REALTIME_CURSOR = 'realtime';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const LOCK_KEY = 'rules-realtime';

/** One event as the real-time rules read it, with its catalog tags and satellite rows. */
export interface RuleEvent {
  id: string;
  appId: string;
  eventId: string;
  recordedAt: Date;
  occurredAt: Date;
  action: string;
  outcome: string;
  actorType: string;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  geoCountry: string | null;
  geoAsn: number | null;
  ipScope: string | null;
  uaBrowser: string | null;
  uaOs: string | null;
  uaDeviceClass: string | null;
  clientType: string | null;
  deviceModel: string | null;
  details: Prisma.JsonValue;
  tags: string[];
  deviceId: string | null;
  geoCity: string | null;
  geoLatitude: number | null;
  geoLongitude: number | null;
  geoAccuracyKm: number | null;
  deviceLatitude: number | null;
  deviceLongitude: number | null;
  deviceAccuracyM: number | null;
}

type Tx = Prisma.TransactionClient;

// The rules that run on every event (docs/security.md#detection-rules), in
// order, behind a cursor: (recorded_at, id) of the last event read. Events
// newer than 20 s are left for the next pass, since an ingest transaction
// may still commit with a recorded_at up to 15 s old (docs/adr/0008): none is
// ever skipped. One instance at a time (an advisory lock), one transaction
// per batch: the cursor moves with the alerts, webhooks and erasures the
// batch caused, or not at all.
//
// Per event: an account deletion (tag privacy.erasure_requested) erases the
// subject's personal data; a response action's outcome (tag
// response.executed) settles it; an event that occurred before its actor's or
// its user's last erasure (explorer/blocked.ts) loses its personal data when
// it arrived after that erasure, and nothing more is processed for a blocked
// actor; a successful sign-in (tag auth.sign_in) is
// checked for a new device or country, impossible travel, a hosting IP, a
// device far from its IP, a dormant account; session reuse and privilege
// changes alert at once. Every user's activity updates what the rules
// remember of them (actor_devices, actor_countries, actor_profiles).
@Injectable()
export class RealtimeRulesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rules');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;
  private lagSeconds: number | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly webhooks: WebhookOutboxService,
    private readonly responseActions: ResponseActionsService,
    private readonly enrichment: EnrichmentService,
  ) {}

  onApplicationBootstrap(): void {
    observeRulesLag(() => this.lagSeconds);
    this.timer = setInterval(() => void this.tick(), REALTIME_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reads every event up to the horizon now; answers how many. One pass at a time. */
  async runOnce(): Promise<number> {
    while (this.running !== undefined) await this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async tick(): Promise<void> {
    if (this.running !== undefined) return;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.warn(`Real-time rules paused: ${errorSummary(error)}`);
    }
  }

  private async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const read = await this.batch();
      total += read;
      if (read < REALTIME_BATCH) break;
    }
    await this.refreshLag();
    return total;
  }

  /** One batch in one transaction; answers how many events it read (0: none, or another instance runs). */
  private async batch(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean; horizon: Date }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS "locked",
                 date_trunc('milliseconds', now() - make_interval(secs => ${REALTIME_HORIZON_MS / 1000})) AS "horizon"`;
        if (lock?.locked !== true) return 0;
        const cursor = await tx.ruleCursor.findUnique({ where: { name: REALTIME_CURSOR } });
        const events = await this.read(
          tx,
          cursor?.recordedAt ?? new Date(0),
          cursor?.eventPk ?? ZERO_UUID,
          lock.horizon,
        );
        for (const event of events) await this.evaluate(tx, event);
        const last = events.at(-1);
        if (last !== undefined) {
          await tx.ruleCursor.upsert({
            where: { name: REALTIME_CURSOR },
            create: { name: REALTIME_CURSOR, recordedAt: last.recordedAt, eventPk: last.id },
            update: { recordedAt: last.recordedAt, eventPk: last.id },
          });
        }
        return events.length;
      },
      { timeout: 60_000 },
    );
  }

  private read(tx: Tx, afterAt: Date, afterId: string, horizon: Date): Promise<RuleEvent[]> {
    return tx.$queryRaw<RuleEvent[]>`
      SELECT e."id", e."app_id" AS "appId", e."event_id" AS "eventId", e."recorded_at" AS "recordedAt",
             e."occurred_at" AS "occurredAt", e."action", e."outcome"::text AS "outcome",
             e."actor_type"::text AS "actorType", e."actor_id" AS "actorId",
             e."resource_type" AS "resourceType", e."resource_id" AS "resourceId",
             e."geo_country" AS "geoCountry", e."geo_asn" AS "geoAsn", e."ip_scope"::text AS "ipScope",
             e."ua_browser" AS "uaBrowser", e."ua_os" AS "uaOs", e."ua_device_class" AS "uaDeviceClass",
             e."client_type"::text AS "clientType", e."client_device_model" AS "deviceModel",
             e."details", coalesce(ca."tags", '{}') AS "tags",
             p."device_id" AS "deviceId", p."geo_city" AS "geoCity",
             p."geo_latitude"::float8 AS "geoLatitude", p."geo_longitude"::float8 AS "geoLongitude",
             p."geo_accuracy_km" AS "geoAccuracyKm",
             l."latitude"::float8 AS "deviceLatitude", l."longitude"::float8 AS "deviceLongitude",
             l."accuracy_m" AS "deviceAccuracyM"
      FROM "audit_events" e
      LEFT JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id" AND ca."action" = e."action"
      LEFT JOIN "event_personal" p ON p."event_pk" = e."id"
      LEFT JOIN "event_locations" l ON l."event_pk" = e."id"
      WHERE (e."recorded_at", e."id") > (${afterAt}, ${afterId}::uuid)
        AND e."recorded_at" < ${horizon}
      ORDER BY e."recorded_at", e."id"
      LIMIT ${REALTIME_BATCH}`;
  }

  /** The rules for one event, in the batch's transaction. */
  async evaluate(tx: Tx, event: RuleEvent): Promise<void> {
    // Audit Hub's own events have no published catalog: their tags are in code.
    const tags = new Set(
      event.appId === SYSTEM_APP_ID && event.tags.length === 0
        ? hubTagsOf(event.action)
        : event.tags,
    );
    if (tags.has('privacy.erasure_requested') && event.outcome === 'success') {
      await this.erase(tx, event);
    }
    if (tags.has('response.executed')) await this.settleAction(tx, event);
    if (await this.blockedActor(tx, event)) return;
    if (event.actorType !== 'user' || event.actorId === null) return;
    const actorId = event.actorId;

    if (tags.has('auth.session_reuse')) {
      await this.alerts.raise(tx, {
        appId: event.appId,
        rule: 'session_reuse',
        severity: 'high',
        groupKey: `session_reuse:${event.appId}:${actorId}`,
        subject: actorId,
        title: `A session token of user ${actorId} was used again after it was replaced`,
        summary: { subject: actorId, eventId: event.eventId },
        eventPks: [event.id],
        at: event.recordedAt,
      });
    }
    if (tags.has('iam.privilege_changed') && event.outcome === 'success') {
      const target =
        event.resourceType === 'user' && event.resourceId !== null ? event.resourceId : actorId;
      await this.alerts.raise(tx, {
        appId: event.appId,
        rule: 'privilege_change',
        severity: 'medium',
        groupKey: `privilege_change:${event.appId}:${target}`,
        subject: target,
        title: `Privileges of user ${target} changed by user ${actorId}`,
        summary: { subject: target, changedBy: actorId, action: event.action },
        eventPks: [event.id],
        at: event.recordedAt,
      });
    }

    const profile = await tx.actorProfile.findUnique({
      where: { appId_actorId: { appId: event.appId, actorId } },
    });
    const signIn = tags.has('auth.sign_in') && event.outcome === 'success';
    if (signIn) await this.signIn(tx, event, actorId, profile);
    await this.remember(tx, event, actorId, profile, signIn);
  }

  private async signIn(
    tx: Tx,
    event: RuleEvent,
    actorId: string,
    profile: Prisma.ActorProfileGetPayload<object> | null,
  ): Promise<void> {
    const where = { appId: event.appId, actorId };
    const deviceKey = deviceKeyOf(event);
    const [devices, knownDevice, countries, knownCountry] = await Promise.all([
      tx.actorDevice.count({ where }),
      deviceKey === null
        ? Promise.resolve(null)
        : tx.actorDevice.findUnique({
            where: { appId_actorId_deviceKey: { ...where, deviceKey } },
            select: { deviceKey: true },
          }),
      tx.actorCountry.count({ where }),
      event.geoCountry === null
        ? Promise.resolve(null)
        : tx.actorCountry.findUnique({
            where: { appId_actorId_country: { ...where, country: event.geoCountry } },
            select: { country: true },
          }),
    ]);
    const lastSeenAt = profile?.lastSeenAt ?? (await this.lastActivityBefore(tx, event, actorId));
    const verdict = signInSignals({
      at: event.recordedAt,
      knownDevice: deviceKey === null || knownDevice !== null,
      hasDevices: devices > 0,
      country: event.geoCountry,
      knownCountry: knownCountry !== null,
      hasCountries: countries > 0,
      ipPlace: ipPlaceOf(event),
      devicePlace: devicePlaceOf(event),
      previous:
        profile?.lastLatitude === null ||
        profile?.lastLatitude === undefined ||
        profile.lastLongitude === null ||
        profile.lastLocationAt === null
          ? null
          : {
              latitude: Number(profile.lastLatitude),
              longitude: Number(profile.lastLongitude),
              accuracyKm: profile.lastAccuracyKm ?? 0,
              at: profile.lastLocationAt,
            },
      hostingIp: this.enrichment.isHosting(event.geoAsn),
      lastSeenAt,
    });

    if (verdict.signals.length > 0) {
      await this.alerts.raise(tx, {
        appId: event.appId,
        rule: 'suspicious_sign_in',
        severity: signInSeverity(verdict.signals),
        groupKey: `suspicious_sign_in:${event.appId}:${actorId}`,
        subject: actorId,
        title: `Suspicious sign-in of user ${actorId}: ${verdict.signals.join(', ')}`,
        // What the panel explains it with (alerts/alert-explanation.ts): the
        // device's families and figures, never a place or an address.
        summary: {
          subject: actorId,
          signals: verdict.signals,
          ...(event.geoCountry === null ? {} : { country: event.geoCountry }),
          ...deviceOf(event),
          ...(verdict.travel === undefined
            ? {}
            : {
                travelKm: verdict.travel.distanceKm,
                travelMinutes: verdict.travel.minutes,
                travelSpeedKmh: verdict.travel.speedKmh,
              }),
          ...(verdict.mismatchKm === undefined ? {} : { mismatchKm: verdict.mismatchKm }),
          eventId: event.eventId,
        },
        eventPks: [event.id],
        at: event.recordedAt,
      });
      // "Was it you?": the application asks its user (docs/adr/0013).
      await this.webhooks.toApp(
        {
          appId: event.appId,
          type: 'security.sign_in_suspicious',
          data: {
            subject: actorId,
            eventId: event.eventId,
            occurredAt: event.occurredAt.toISOString(),
            signals: verdict.signals,
            context: {
              ...(event.geoCountry === null ? {} : { country: event.geoCountry }),
              ...(event.geoCity === null ? {} : { city: event.geoCity }),
              ...(event.clientType === null ? {} : { clientType: event.clientType }),
              ...(event.deviceModel === null ? {} : { deviceModel: event.deviceModel }),
            },
          },
        },
        tx,
      );
    }
    if (verdict.dormant) {
      await this.alerts.raise(tx, {
        appId: event.appId,
        rule: 'dormant_account',
        severity: 'medium',
        groupKey: `dormant_account:${event.appId}:${actorId}`,
        subject: actorId,
        title: `User ${actorId} signed in after more than 90 days without activity`,
        summary: {
          subject: actorId,
          ...(lastSeenAt === null
            ? {}
            : {
                lastSeenAt: lastSeenAt.toISOString(),
                daysAway: Math.floor(
                  (event.recordedAt.getTime() - lastSeenAt.getTime()) / 86_400_000,
                ),
              }),
        },
        eventPks: [event.id],
        at: event.recordedAt,
      });
    }
  }

  /** What the rules remember of an account: its devices, countries and last place. */
  private async remember(
    tx: Tx,
    event: RuleEvent,
    actorId: string,
    profile: Prisma.ActorProfileGetPayload<object> | null,
    signIn: boolean,
  ): Promise<void> {
    const at = event.recordedAt;
    const keys = { appId: event.appId, actorId };
    const place = ipPlaceOf(event) ?? devicePlaceOf(event);
    const located =
      place === null
        ? {}
        : {
            lastLatitude: place.latitude.toFixed(3),
            lastLongitude: place.longitude.toFixed(3),
            lastAccuracyKm: Math.round(place.accuracyKm),
            lastLocationAt: at,
          };
    if (profile === null) {
      await tx.actorProfile.create({
        data: { ...keys, lastSeenAt: at, ...(signIn ? { lastSignInAt: at } : {}), ...located },
      });
    } else {
      await tx.actorProfile.update({
        where: { appId_actorId: keys },
        data: { lastSeenAt: at, ...(signIn ? { lastSignInAt: at } : {}), ...located },
      });
    }
    if (!signIn) return;
    const deviceKey = deviceKeyOf(event);
    if (deviceKey !== null) {
      await tx.actorDevice.upsert({
        where: { appId_actorId_deviceKey: { ...keys, deviceKey } },
        create: { ...keys, deviceKey, firstSeenAt: at, lastSeenAt: at },
        update: { lastSeenAt: at },
      });
    }
    if (event.geoCountry !== null) {
      await tx.actorCountry.upsert({
        where: { appId_actorId_country: { ...keys, country: event.geoCountry } },
        create: { ...keys, country: event.geoCountry, firstSeenAt: at, lastSeenAt: at },
        update: { lastSeenAt: at },
      });
    }
  }

  /** The account's activity before this event, when the rules forgot it (swept after 90 days). */
  private async lastActivityBefore(
    tx: Tx,
    event: RuleEvent,
    actorId: string,
  ): Promise<Date | null> {
    const row = await tx.auditEvent.findFirst({
      where: { appId: event.appId, actorId, recordedAt: { lt: event.recordedAt } },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    return row?.recordedAt ?? null;
  }

  /** An account deleted in the application: its personal data goes here too (contract.md). */
  private async erase(tx: Tx, event: RuleEvent): Promise<void> {
    const subject =
      event.resourceType === 'user' && event.resourceId !== null ? event.resourceId : event.actorId;
    if (subject === null) return;
    const [result] = await tx.$queryRaw<
      { personal_deleted: number; location_deleted: number; held: number }[]
    >`SELECT * FROM audit_erase_subject(${event.appId}::uuid, ${subject}, 'event')`;
    this.logger.log(
      `Erasure of a subject of application ${event.appId} (event ${event.id}): ${String(result?.personal_deleted ?? 0)} personal and ${String(result?.location_deleted ?? 0)} location rows deleted, ${String(result?.held ?? 0)} held`,
    );
  }

  /**
   * Whether the event's actor is blocked for it: it occurred before their last
   * erasure. When its actor or its user is, the event arrived after that
   * erasure (it waited in the application's queue): its personal rows go too,
   * unless a legal hold keeps it (audit_erase_late).
   */
  private async blockedActor(tx: Tx, event: RuleEvent): Promise<boolean> {
    const blockedFor = async (subject: string | null) =>
      subject !== null && isBlocked(await blockOf(tx, event.appId, subject), event.occurredAt);
    const actor = await blockedFor(event.actorType === 'user' ? event.actorId : null);
    const resource =
      !actor && (await blockedFor(event.resourceType === 'user' ? event.resourceId : null));
    if (actor || resource) {
      const [row] = await tx.$queryRaw<{ erased: boolean }[]>`
        SELECT audit_erase_late(${event.id}::uuid) AS "erased"`;
      if (row?.erased === true) {
        this.logger.log(
          `Personal data of event ${event.id} erased: it arrived after its subject's erasure`,
        );
      }
    }
    return actor;
  }

  /** audit.response_action.executed: { actionId, result } in its details. */
  private async settleAction(tx: Tx, event: RuleEvent): Promise<void> {
    const details = event.details as { actionId?: unknown; result?: unknown } | null;
    const actionId = details?.actionId;
    const result = details?.result;
    if (typeof actionId !== 'string' || typeof result !== 'string') return;
    if (!(RESULTS as readonly string[]).includes(result)) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionId)) return;
    await this.responseActions.settle(
      tx,
      event.appId,
      { actionId, result: result as (typeof RESULTS)[number] },
      event.id,
    );
  }

  private async refreshLag(): Promise<void> {
    try {
      const cursor = await this.prisma.ruleCursor.findUnique({ where: { name: REALTIME_CURSOR } });
      const [row] = await this.prisma.$queryRaw<{ oldest: Date | null; now: Date }[]>`
        SELECT min(e."recorded_at") AS "oldest", now() AS "now"
        FROM "audit_events" e
        WHERE (e."recorded_at", e."id") > (${cursor?.recordedAt ?? new Date(0)}, ${cursor?.eventPk ?? ZERO_UUID}::uuid)
          AND e."recorded_at" < now() - make_interval(secs => ${REALTIME_HORIZON_MS / 1000})`;
      const oldest = row?.oldest ?? null;
      this.lagSeconds =
        row === undefined || oldest === null
          ? 0
          : Math.max(0, (row.now.getTime() - oldest.getTime()) / 1000);
    } catch (error) {
      this.logger.warn(`Could not read the rules' lag: ${errorSummary(error)}`);
    }
  }
}

/**
 * The device, as the rules remember it: a digest of the installation id when
 * the client sent one, else of the user agent's family; null when neither
 * is known (the rule then stays quiet).
 */
export function deviceKeyOf(
  event: Pick<RuleEvent, 'appId' | 'deviceId' | 'uaBrowser' | 'uaOs' | 'uaDeviceClass'>,
): string | null {
  const source =
    event.deviceId !== null
      ? `device:${event.deviceId}`
      : event.uaBrowser !== null || event.uaOs !== null
        ? `ua:${event.uaBrowser ?? ''}|${event.uaOs ?? ''}|${event.uaDeviceClass ?? ''}`
        : null;
  if (source === null) return null;
  return createHash('sha256').update(`${event.appId}:${source}`).digest('hex').slice(0, 32);
}

/** Where the IP is, when it is a public address with coordinates. */
export function ipPlaceOf(
  event: Pick<RuleEvent, 'ipScope' | 'geoLatitude' | 'geoLongitude' | 'geoAccuracyKm'>,
): Place | null {
  if (event.ipScope !== 'public' || event.geoLatitude === null || event.geoLongitude === null) {
    return null;
  }
  return {
    latitude: event.geoLatitude,
    longitude: event.geoLongitude,
    accuracyKm: event.geoAccuracyKm ?? 0,
  };
}

/** Where the device said it was, when it sent its location. */
export function devicePlaceOf(
  event: Pick<RuleEvent, 'deviceLatitude' | 'deviceLongitude' | 'deviceAccuracyM'>,
): Place | null {
  if (event.deviceLatitude === null || event.deviceLongitude === null) return null;
  // Rounded to 0.01° by the connector: about a kilometre of its own.
  return {
    latitude: event.deviceLatitude,
    longitude: event.deviceLongitude,
    accuracyKm: (event.deviceAccuracyM ?? 0) / 1000 + 1,
  };
}

/** The device an alert names: families and model, as the event's row has them (no id). */
export function deviceOf(
  event: Pick<RuleEvent, 'uaBrowser' | 'uaOs' | 'clientType' | 'deviceModel'>,
): Record<string, string> {
  return {
    ...(event.clientType === null ? {} : { clientType: event.clientType }),
    ...(event.deviceModel === null ? {} : { deviceModel: event.deviceModel }),
    ...(event.uaBrowser === null ? {} : { browser: event.uaBrowser }),
    ...(event.uaOs === null ? {} : { os: event.uaOs }),
  };
}
