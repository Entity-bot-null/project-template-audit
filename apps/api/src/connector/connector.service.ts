import { Injectable } from '@nestjs/common';
import type {
  ActivityItem,
  ActivityPage,
  SubjectExportItem,
  SubjectExportPage,
} from 'audit-contract';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { afterPosition, decodeCursor, encodeCursor } from '../explorer/cursor.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import type { AuthenticatedApp } from '../ingest/ingest.types.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { blockOf } from '../explorer/blocked.js';

/** DB-IP Lite's terms: wherever a location derived from it is shown (docs/adr/0011). */
export const GEOIP_ATTRIBUTION = 'IP Geolocation by DB-IP (https://db-ip.com)';
const EXPORT_PAGE = 100;

const opt = <K extends string, V>(key: K, value: V | null | undefined) =>
  (value === null || value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

const cursorWhere = (cursor: string | undefined) => {
  const position = decodeCursor(cursor);
  return position === undefined
    ? Prisma.sql`TRUE`
    : Prisma.sql`(e."recorded_at", e."id") < (${position.recordedAt}, ${position.id}::uuid)`;
};

// What an application asks Audit Hub about one of its users (contract.md,
// "Query API for applications"), signed like ingestion: only that
// application's data, only that subject's. Each call is an audit_access
// event of Audit Hub's own.
@Injectable()
export class ConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: EnrichmentService,
    private readonly hubAudit: HubAuditService,
  ) {}

  /**
   * "My account's security": the actions the catalog marks user-visible,
   * minimal fields, no IP. Of a subject blocked after an erasure
   * (explorer/blocked.ts), only what occurred after their last one: for a
   * deleted account, an empty page, as every contract version reads it.
   */
  async activity(
    app: AuthenticatedApp,
    subject: string,
    query: { cursor?: string; limit: number },
  ): Promise<ActivityPage> {
    // A cursor it did not give is refused first (400), blocked or not.
    const after = cursorWhere(query.cursor);
    const through = (await blockOf(this.prisma, app.appId, subject))?.through ?? null;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        eventId: string;
        recordedAt: Date;
        occurredAt: Date;
        action: string;
        outcome: ActivityItem['outcome'];
        description: string;
        clientType: NonNullable<ActivityItem['client']>['type'] | null;
        os: string | null;
        deviceModel: string | null;
        appVersion: string | null;
        browser: string | null;
        country: string | null;
        city: string | null;
      }[]
    >`
      SELECT e."id", e."event_id" AS "eventId", e."recorded_at" AS "recordedAt",
             e."occurred_at" AS "occurredAt", e."action", e."outcome"::text AS "outcome",
             ca."description", e."client_type"::text AS "clientType",
             coalesce(e."client_os", e."ua_os") AS "os", e."client_device_model" AS "deviceModel",
             e."client_app_version" AS "appVersion", e."ua_browser" AS "browser",
             e."geo_country" AS "country", p."geo_city" AS "city"
      FROM "audit_events" e
      JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id"
        AND ca."action" = e."action" AND ca."user_visible"
      LEFT JOIN "event_personal" p ON p."event_pk" = e."id"
      WHERE e."app_id" = ${app.appId}::uuid
        AND (e."actor_id" = ${subject} OR (e."resource_type" = 'user' AND e."resource_id" = ${subject}))
        AND ${after}
        AND (${through}::timestamptz IS NULL OR e."occurred_at" > ${through}::timestamptz)
      ORDER BY e."recorded_at" DESC, e."id" DESC
      LIMIT ${query.limit + 1}`;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    await this.read(app, subject, 'activity');
    const located = items.some((row) => row.country !== null);
    return {
      items: items.map((row) => ({
        eventId: row.eventId,
        action: row.action,
        description: row.description.slice(0, 500),
        outcome: row.outcome,
        occurredAt: row.occurredAt.toISOString(),
        client: {
          ...opt('type', row.clientType),
          ...opt('os', row.os?.slice(0, 32)),
          ...opt('deviceModel', row.deviceModel?.slice(0, 64)),
          ...opt('appVersion', row.appVersion?.slice(0, 32)),
          ...opt('browser', row.browser?.slice(0, 64)),
        },
        location: { ...opt('country', row.country), ...opt('city', row.city?.slice(0, 128)) },
      })),
      ...(rows.length > query.limit && last !== undefined
        ? { nextCursor: encodeCursor({ recordedAt: last.recordedAt, id: last.id }) }
        : {}),
      ...(located && this.enrichment.geolocation ? { attribution: GEOIP_ATTRIBUTION } : {}),
    };
  }

  /** Right of access: every event of the subject, with what is still kept of it. */
  async export(
    app: AuthenticatedApp,
    subject: string,
    cursor?: string,
  ): Promise<SubjectExportPage> {
    const position = decodeCursor(cursor);
    // Blocked after an erasure: what occurred up to the last one is kept,
    // never processed for the person.
    const block = await blockOf(this.prisma, app.appId, subject);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        appId: app.appId,
        ...(block === null ? {} : { occurredAt: { gt: block.through } }),
        AND: [
          { OR: [{ actorId: subject }, { resourceType: 'user', resourceId: subject }] },
          afterPosition(position),
        ],
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_PAGE + 1,
      include: { personal: true, location: true },
    });
    const items = rows.slice(0, EXPORT_PAGE);
    const last = items.at(-1);
    await this.read(app, subject, 'export');
    return {
      items: items.map((row): SubjectExportItem => ({
        eventId: row.eventId,
        action: row.action,
        category: row.category,
        outcome: row.outcome,
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
        role: row.actorId === subject ? 'actor' : 'resource',
        ...opt('details', row.details),
        ...(row.changeBefore === null && row.changeAfter === null
          ? {}
          : { change: { ...opt('before', row.changeBefore), ...opt('after', row.changeAfter) } }),
        client: {
          ...opt('type', row.clientType),
          ...opt('os', row.clientOs?.slice(0, 32)),
          ...opt('deviceModel', row.clientDeviceModel?.slice(0, 64)),
          ...opt('appVersion', row.clientAppVersion?.slice(0, 32)),
        },
        network: {
          ...opt('ip', row.personal?.ip),
          ...opt('userAgent', row.personal?.userAgent?.slice(0, 1024)),
          ...opt('country', row.geoCountry),
          ...opt('city', row.personal?.geoCity?.slice(0, 128)),
        },
        ...(row.location === null
          ? {}
          : {
              location: {
                latitude: Number(row.location.latitude),
                longitude: Number(row.location.longitude),
                capturedAt: row.location.capturedAt.toISOString(),
              },
            }),
      })),
      ...(rows.length > EXPORT_PAGE && last !== undefined
        ? { nextCursor: encodeCursor({ recordedAt: last.recordedAt, id: last.id }) }
        : {}),
      ...(this.enrichment.geolocation ? { attribution: GEOIP_ATTRIBUTION } : {}),
    };
  }

  private read(app: AuthenticatedApp, subject: string, what: 'activity' | 'export') {
    return this.hubAudit.record({
      action: 'hub.connector.read',
      actor: { type: 'service', id: app.slug },
      resource: { type: 'app_user', id: subject },
      details: { appId: app.appId, what },
    });
  }
}
