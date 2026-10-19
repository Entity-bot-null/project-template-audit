import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientHints } from 'audit-contract';
import { emailHmac } from 'audit-contract/node';
import type { Request } from 'express';
import { AppAccessService } from '../access/app-access.service.js';
import type { RequestUser } from '../common/types/request-user.js';
import { ConnectedAppsService, SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { canonicalIp } from '../enrichment/ip.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { describeUserAgent } from '../enrichment/user-agent.js';
import { HUB_ACTIONS, type HubAction, hubActionsTagged } from '../hub-audit/hub-actions.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { hex } from '../integrity/seal-math.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type Block,
  blockedApps,
  blockedWithEmail,
  blockOf,
  isBlocked,
  presentUnblocked,
  withoutBlocked,
  withoutSubjects,
} from './blocked.js';
import { afterPosition, decodeCursor, pageOf } from './cursor.js';
import {
  type EventDetail,
  type EventFilters,
  type EventPage,
  type EventQuery,
  type EventSummary,
  HIGH_RISK_SCORE,
  type HistoryQuery,
  type Overview,
  type SecurityOverview,
  type SubjectQuery,
} from './dto/explorer.schemas.js';

const DAY_MS = 86_400_000;
const RELATED_LIMIT = 50;

export const SUMMARY_SELECT = {
  id: true,
  eventId: true,
  appId: true,
  recordedAt: true,
  occurredAt: true,
  category: true,
  catalogVersionId: true,
  action: true,
  outcome: true,
  severity: true,
  riskScore: true,
  actorType: true,
  actorId: true,
  actorRole: true,
  resourceType: true,
  resourceId: true,
  requestId: true,
  httpStatus: true,
  clientType: true,
  geoCountry: true,
  ipScope: true,
  app: { select: { slug: true } },
  personal: { select: { actorLabel: true } },
} satisfies Prisma.AuditEventSelect;

type SummaryRow = Prisma.AuditEventGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** What a page of events says in words, looked up once per page (ExplorerService.summaries). */
export interface SummaryLabels {
  /** Catalog descriptions by `${catalogVersionId} ${action}`. */
  descriptions: ReadonlyMap<string, string>;
  /** Names of Audit Hub's own accounts, the actors of its events, by id. */
  staff: ReadonlyMap<string, string>;
}

const NO_LABELS: SummaryLabels = { descriptions: new Map(), staff: new Map() };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const catalogKey = (catalogVersionId: string, action: string) => `${catalogVersionId} ${action}`;

const ORDER: Prisma.AuditEventOrderByWithRelationInput[] = [{ recordedAt: 'desc' }, { id: 'desc' }];

/** The filter names, never their values: what a search records about itself. */
const filterNames = (filters: EventFilters) =>
  Object.entries(filters as Record<string, unknown>)
    .filter(([name, value]) => value !== undefined && !['cursor', 'limit'].includes(name))
    .map(([name]) => name);

// The admin pages' view of the audit log: the explorer, an event's detail,
// a subject's activity (360°), a resource's history, an application's
// security overview and the overview of every application. Access by
// application is part of every query (AppAccessService): an event of another
// application answers 404, as one that does not exist. Each read is an
// audit_access event of Audit Hub's own (docs/design/audit-hub).
@Injectable()
export class ExplorerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AppAccessService,
    private readonly apps: ConnectedAppsService,
    private readonly hubAudit: HubAuditService,
    private readonly enrichment: EnrichmentService,
  ) {}

  /** The Prisma where of the filters, inside the caller's applications; undefined: nothing visible. */
  async whereOf(
    user: RequestUser,
    filters: EventFilters,
  ): Promise<Prisma.AuditEventWhereInput | undefined> {
    if (filters.email !== undefined && filters.appId === undefined) {
      throw new BadRequestException('email: choose an application (its pseudonyms are its own)');
    }
    if (filters.appId !== undefined && !(await this.access.canSee(user, filters.appId))) {
      return undefined;
    }
    const visible = await this.access.appFilter(user);
    const ip = filters.ip === undefined ? undefined : canonicalIp(filters.ip);
    const recordedAt = {
      ...(filters.from === undefined ? {} : { gte: new Date(filters.from) }),
      ...(filters.to === undefined ? {} : { lt: new Date(filters.to) }),
    };
    return {
      ...visible,
      ...(filters.appId === undefined ? {} : { appId: filters.appId }),
      ...(Object.keys(recordedAt).length === 0 ? {} : { recordedAt }),
      ...(filters.category === undefined ? {} : { category: filters.category }),
      ...(filters.action === undefined ? {} : { action: filters.action }),
      ...(filters.outcome === undefined ? {} : { outcome: filters.outcome }),
      ...(filters.severity === undefined ? {} : { severity: filters.severity }),
      ...(filters.minRisk === undefined ? {} : { riskScore: { gte: filters.minRisk } }),
      ...(filters.actorId === undefined ? {} : { actorId: filters.actorId }),
      ...(filters.email === undefined || filters.appId === undefined
        ? {}
        : {
            actorEmailHmac: emailHmac(await this.apps.pseudonymKey(filters.appId), filters.email),
          }),
      ...(filters.resourceType === undefined ? {} : { resourceType: filters.resourceType }),
      ...(filters.resourceId === undefined ? {} : { resourceId: filters.resourceId }),
      ...(ip === undefined ? {} : { personal: { is: { ip } } }),
      ...(filters.country === undefined ? {} : { geoCountry: filters.country }),
      ...(filters.clientType === undefined ? {} : { clientType: filters.clientType }),
      ...(filters.requestId === undefined ? {} : { requestId: filters.requestId }),
    };
  }

  async search(user: RequestUser, query: EventQuery, req: Request): Promise<EventPage> {
    const where = await this.whereOf(user, query);
    const blocked =
      where === undefined ? { apps: [], where: [] } : await this.blockedBy(user, query);
    const page: EventPage =
      where === undefined
        ? { items: [], nextCursor: null }
        : await this.page(
            { AND: [where, ...blocked.where, afterPosition(decodeCursor(query.cursor))] },
            query.limit,
          );
    if (blocked.apps.length > 0) page.blocked = true;
    await this.hubAudit.record({
      action: 'hub.events.searched',
      actor: actorOf(user),
      details: {
        ...(query.appId === undefined ? {} : { appId: query.appId }),
        filters: filterNames(query),
        results: page.items.length,
      },
      request: req,
    });
    return page;
  }

  async detail(user: RequestUser, id: string, req: Request): Promise<EventDetail> {
    const row = await this.prisma.auditEvent.findUnique({
      where: { id },
      include: { app: { select: { slug: true } }, personal: true, location: true },
    });
    if (row === null || !(await this.access.canSee(user, row.appId))) {
      throw new NotFoundException('Event not found');
    }
    const [catalog, related, integrity, blockedActor, blockedResource, labels] = await Promise.all([
      this.catalogOf(row),
      row.requestId === null
        ? Promise.resolve([])
        : this.prisma.auditEvent.findMany({
            where: { appId: row.appId, requestId: row.requestId, id: { not: row.id } },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
            take: RELATED_LIMIT,
            select: SUMMARY_SELECT,
          }),
      this.integrityOf(row),
      row.actorId === null ? null : blockOf(this.prisma, row.appId, row.actorId),
      row.resourceType === 'user' && row.resourceId !== null
        ? blockOf(this.prisma, row.appId, row.resourceId)
        : null,
      this.staffLabels([row]),
    ]);
    // Only what occurred up to the last erasure is blocked.
    const block = [blockedActor, blockedResource].find((candidate): candidate is Block =>
      isBlocked(candidate, row.occurredAt),
    );
    await this.hubAudit.record({
      action: 'hub.event.viewed',
      actor: actorOf(user),
      resource: { type: 'audit_event', id: row.id },
      details: { appId: row.appId },
      request: req,
    });
    return {
      ...toSummary(row, {
        ...labels,
        descriptions:
          catalog.description === null || row.catalogVersionId === null
            ? NO_LABELS.descriptions
            : new Map([[catalogKey(row.catalogVersionId, row.action), catalog.description]]),
      }),
      blockedSince: block?.since.toISOString() ?? null,
      sequence:
        row.sequenceEpoch === null || row.sourceSeq === null
          ? null
          : { epoch: row.sequenceEpoch, seq: row.sourceSeq.toString() },
      catalog,
      reason: row.reason,
      actorDetail: {
        emailPseudonym: row.actorEmailHmac,
        impersonatorId: row.impersonatorId,
        sessionRef: row.sessionRef,
      },
      parentResource:
        row.parentResourceType === null || row.parentResourceId === null
          ? null
          : { type: row.parentResourceType, id: row.parentResourceId },
      change: { before: row.changeBefore, after: row.changeAfter, fields: row.changedFields },
      request: {
        method: row.httpMethod,
        route: row.httpRoute,
        traceId: row.traceId,
        durationMs: row.durationMs,
      },
      client: {
        appVersion: row.clientAppVersion,
        appBuild: row.clientAppBuild,
        os: row.clientOs,
        osVersion: row.clientOsVersion,
        deviceModel: row.clientDeviceModel,
        locale: row.clientLocale,
        timeZone: row.clientTimeZone,
        networkType: row.clientNetworkType,
        route: row.clientRoute,
        sdk: row.clientSdk,
        declared: row.clientDeclared,
      },
      network: {
        asn: row.geoAsn,
        browser: row.uaBrowser,
        os: row.uaOs,
        deviceClass: row.uaDeviceClass,
      },
      details: row.details,
      personal:
        row.personal === null
          ? null
          : {
              ip: row.personal.ip,
              userAgent: row.personal.userAgent,
              agent: describeUserAgent(
                row.personal.userAgent,
                row.personal.clientHints as ClientHints | null,
              ),
              deviceId: row.personal.deviceId,
              actorLabel: row.personal.actorLabel,
              actorPhone: row.personal.actorPhone,
              resourceLabel: row.personal.resourceLabel,
              subdivision: row.personal.geoSubdivision,
              city: row.personal.geoCity,
              approximateLocation:
                row.personal.geoLatitude === null || row.personal.geoLongitude === null
                  ? null
                  : {
                      latitude: Number(row.personal.geoLatitude),
                      longitude: Number(row.personal.geoLongitude),
                      accuracyKm: row.personal.geoAccuracyKm,
                    },
              change: row.personal.personalChange,
            },
      location:
        row.location === null
          ? null
          : {
              latitude: Number(row.location.latitude),
              longitude: Number(row.location.longitude),
              accuracyM: row.location.accuracyM,
              capturedAt: row.location.capturedAt.toISOString(),
            },
      quality: {
        truncatedFields: row.truncatedFields,
        droppedFields: row.droppedFields,
        flags: row.flags,
      },
      integrity: { ...integrity, contentHash: hex(row.contentHash) },
      related: await this.summaries(related),
    };
  }

  /** A subject's activity in an application (360°), optionally across applications. */
  async subject(
    user: RequestUser,
    appId: string,
    subject: string,
    query: SubjectQuery,
    req: Request,
  ) {
    const app = await this.visibleApp(user, appId);
    // Blocked after an erasure: only what occurred after the last one is shown.
    const block = await blockOf(this.prisma, appId, subject);
    const after = block === null ? {} : { occurredAt: { gt: block.through } };
    const own: Prisma.AuditEventWhereInput = {
      appId,
      ...after,
      OR: [{ actorId: subject }, { resourceType: 'user', resourceId: subject }],
    };
    const otherApps =
      query.acrossApps === true && app.correlationEnabled
        ? await this.sameSubjectElsewhere(user, appId, subject, block?.through)
        : { apps: [], where: undefined };
    const where: Prisma.AuditEventWhereInput =
      otherApps.where === undefined ? own : { OR: [own, otherApps.where] };
    const [events, bounds, profile, devices, countries, openAlerts] = await Promise.all([
      this.page({ AND: [where, afterPosition(decodeCursor(query.cursor))] }, query.limit),
      this.prisma.auditEvent.aggregate({
        where: own,
        _min: { recordedAt: true },
        _max: { recordedAt: true },
      }),
      this.prisma.actorProfile.findUnique({
        where: { appId_actorId: { appId, actorId: subject } },
        select: { lastSignInAt: true },
      }),
      this.prisma.actorDevice.count({ where: { appId, actorId: subject } }),
      this.prisma.actorCountry.findMany({
        where: { appId, actorId: subject },
        orderBy: { lastSeenAt: 'desc' },
        select: { country: true },
      }),
      this.prisma.alert.count({
        where: {
          appId,
          subject,
          status: { in: ['open', 'in_review'] },
          ...(block === null ? {} : { createdAt: { gt: block.through } }),
        },
      }),
    ]);
    await this.hubAudit.record({
      action: 'hub.subject.viewed',
      actor: actorOf(user),
      resource: { type: 'app_user', id: subject },
      details: {
        appId,
        acrossApps: otherApps.where !== undefined,
        ...(block === null ? {} : { blocked: true }),
      },
      request: req,
    });
    return {
      subject,
      appId,
      blockedSince: block?.since.toISOString() ?? null,
      blockedThrough: block?.through.toISOString() ?? null,
      summary: {
        firstSeenAt: bounds._min.recordedAt?.toISOString() ?? null,
        lastSeenAt: bounds._max.recordedAt?.toISOString() ?? null,
        lastSignInAt: profile?.lastSignInAt?.toISOString() ?? null,
        devices,
        countries: countries.map((row) => row.country),
        openAlerts,
        otherApps: otherApps.apps,
      },
      events,
    };
  }

  /** A resource's history: events about it, or about what it contains. */
  async resource(
    user: RequestUser,
    appId: string,
    type: string,
    id: string,
    query: HistoryQuery,
    req: Request,
  ): Promise<EventPage> {
    await this.visibleApp(user, appId);
    const page = await this.page(
      {
        // AND: the cursor's position is an OR of its own, which a spread would overwrite.
        AND: [
          {
            appId,
            OR: [
              { resourceType: type, resourceId: id },
              { parentResourceType: type, parentResourceId: id },
            ],
          },
          afterPosition(decodeCursor(query.cursor)),
        ],
      },
      query.limit,
    );
    await this.hubAudit.record({
      action: 'hub.resource.viewed',
      actor: actorOf(user),
      resource: { type, id },
      details: { appId, type },
      request: req,
    });
    return page;
  }

  /** Failed sign-ins, addresses, countries, a heatmap and the open alerts: one query each. */
  async security(
    user: RequestUser,
    appId: string,
    days: number,
    req: Request,
  ): Promise<SecurityOverview> {
    await this.visibleApp(user, appId);
    const since = new Date(Date.now() - days * DAY_MS);
    const failedHub = appId === SYSTEM_APP_ID ? hubActionsTagged('auth.sign_in_failed') : [];
    const signInHub = appId === SYSTEM_APP_ID ? hubActionsTagged('auth.sign_in') : [];
    const failures = (select: Prisma.Sql) => this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH f AS (
        SELECT e."id", e."recorded_at", e."actor_id", e."actor_email_hmac", p."ip"
        FROM "audit_events" e
        LEFT JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id" AND ca."action" = e."action"
        LEFT JOIN "event_personal" p ON p."event_pk" = e."id"
        WHERE e."app_id" = ${appId}::uuid AND e."recorded_at" >= ${since}
          AND ('auth.sign_in_failed' = ANY(ca."tags")
               OR ('auth.sign_in' = ANY(ca."tags") AND e."outcome" <> 'success')
               OR e."action" = ANY(${failedHub}::text[]))
      ) ${select}`;
    const [perDay, ips, countries, heatmap, anomalies] = await Promise.all([
      failures(Prisma.sql`
        SELECT to_char(date_trunc('day', "recorded_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "day",
               count(*)::int AS "count"
        FROM f GROUP BY 1 ORDER BY 1`),
      failures(Prisma.sql`
        SELECT "ip", count(*)::int AS "count",
               count(DISTINCT coalesce("actor_id", "actor_email_hmac"))::int AS "accounts"
        FROM f WHERE "ip" IS NOT NULL GROUP BY "ip" ORDER BY 2 DESC LIMIT 10`),
      this.prisma.$queryRaw<{ country: string; count: number }[]>`
        SELECT e."geo_country" AS "country", count(*)::int AS "count"
        FROM "audit_events" e
        LEFT JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id" AND ca."action" = e."action"
        WHERE e."app_id" = ${appId}::uuid AND e."recorded_at" >= ${since} AND e."geo_country" IS NOT NULL
          AND ('auth.sign_in' = ANY(ca."tags") OR 'auth.sign_in_failed' = ANY(ca."tags")
               OR e."action" = ANY(${[...signInHub, ...failedHub]}::text[]))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      failures(Prisma.sql`
        SELECT extract(dow FROM "recorded_at" AT TIME ZONE 'UTC')::int AS "dow",
               extract(hour FROM "recorded_at" AT TIME ZONE 'UTC')::int AS "hour",
               count(*)::int AS "count"
        FROM f GROUP BY 1, 2 ORDER BY 1, 2`),
      this.prisma.alert.groupBy({
        by: ['rule', 'severity'],
        where: { appId, status: { in: ['open', 'in_review'] } },
        _count: { _all: true },
        orderBy: { rule: 'asc' },
      }),
    ]);
    await this.hubAudit.record({
      action: 'hub.security.viewed',
      actor: actorOf(user),
      details: { appId },
      request: req,
    });
    return {
      appId,
      days,
      geolocation: this.enrichment.geolocation,
      failedSignIns: perDay as { day: string; count: number }[],
      topIps: ips as { ip: string; count: number; accounts: number }[],
      topCountries: countries,
      heatmap: heatmap as { dow: number; hour: number; count: number }[],
      anomalies: anomalies.map((row) => ({
        rule: row.rule,
        severity: row.severity,
        open: row._count._all,
      })),
    };
  }

  /** Every visible application at a glance: a handful of grouped queries, whatever their number. */
  async overview(user: RequestUser): Promise<Overview> {
    const visible = await this.access.appFilter(user);
    const apps = await this.prisma.connectedApp.findMany({
      where: { system: false, ...(visible.appId === undefined ? {} : { id: visible.appId }) },
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, status: true },
    });
    const ids = apps.map((app) => app.id);
    const since = new Date(Date.now() - DAY_MS);
    const [events, highRisk, rejected, alerts, connectors, gaps, trend, integrity] =
      await Promise.all([
        this.prisma.auditEvent.groupBy({
          by: ['appId'],
          where: { appId: { in: ids }, recordedAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.auditEvent.groupBy({
          by: ['appId'],
          where: {
            appId: { in: ids },
            recordedAt: { gte: since },
            riskScore: { gte: HIGH_RISK_SCORE },
          },
          _count: { _all: true },
        }),
        this.prisma.ingestException.groupBy({
          by: ['appId'],
          where: { appId: { in: ids }, kind: 'rejected', receivedAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.alert.groupBy({
          by: ['appId', 'severity'],
          where: { appId: { in: ids }, status: { in: ['open', 'in_review'] } },
          _count: { _all: true },
        }),
        this.prisma.connectorInstance.groupBy({
          by: ['appId'],
          where: { appId: { in: ids }, lastHeartbeatAt: { gte: since } },
          _max: { lastHeartbeatAt: true },
          _sum: { queueSize: true },
        }),
        this.prisma.sequenceGap.groupBy({
          by: ['appId'],
          where: { appId: { in: ids }, closedAt: null },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ appId: string; hour: number; count: number }[]>`
        SELECT "app_id" AS "appId",
               floor(extract(epoch FROM (now() - "recorded_at")) / 3600)::int AS "hour",
               count(*)::int AS "count"
        FROM "audit_events"
        WHERE "app_id" = ANY(${ids}::uuid[]) AND "recorded_at" >= now() - interval '24 hours'
        GROUP BY 1, 2`,
        this.integrityFor(user, ids),
      ]);
    const count = (rows: { appId: string; _count: { _all: number } }[], id: string) =>
      rows.find((row) => row.appId === id)?._count._all ?? 0;
    return {
      since: since.toISOString(),
      integrity,
      apps: apps.map((app) => {
        const connector = connectors.find((row) => row.appId === app.id);
        const hours = Array.from({ length: 24 }, () => 0);
        for (const row of trend) {
          if (row.appId === app.id && row.hour >= 0 && row.hour < 24)
            hours[23 - row.hour] = row.count;
        }
        return {
          appId: app.id,
          slug: app.slug,
          name: app.name,
          status: app.status,
          events24h: count(events, app.id),
          highRisk24h: count(highRisk, app.id),
          rejected24h: count(rejected, app.id),
          openAlerts: Object.fromEntries(
            alerts
              .filter((row) => row.appId === app.id)
              .map((row) => [row.severity, row._count._all]),
          ),
          lastHeartbeatAt: connector?._max.lastHeartbeatAt?.toISOString() ?? null,
          queueSize: connector?._sum.queueSize ?? 0,
          openGaps: count(gaps, app.id),
          trend: hours,
        };
      }),
    };
  }

  /**
   * The latest verification that covered the caller's applications (all of
   * them, or one of theirs), as it concerns them: a failure elsewhere is not
   * theirs when every failure is known (the sample holds them all) and none
   * is in one of their applications. Administrators see every run as it is.
   */
  private async integrityFor(user: RequestUser, ids: string[]): Promise<Overview['integrity']> {
    const runs = await this.prisma.integrityVerification.findMany({
      orderBy: { finishedAt: 'desc' },
      take: 20,
      select: { outcome: true, scope: true, failures: true, failureSample: true, finishedAt: true },
    });
    const everything = user.role === 'admin';
    const visible = new Set(ids);
    const run = runs.find((candidate) => {
      const appId = (candidate.scope as { appId?: string } | null)?.appId;
      return appId === undefined || everything || visible.has(appId);
    });
    if (run === undefined) return null;
    const finishedAt = run.finishedAt.toISOString();
    const outcome = run.outcome as NonNullable<Overview['integrity']>['outcome'];
    if (outcome === 'failed' && !everything) {
      const sample = (run.failureSample as { appId?: string }[] | null) ?? [];
      const theirs = sample.some(
        (failure) => failure.appId === undefined || visible.has(failure.appId),
      );
      if (!theirs && sample.length >= run.failures) return { outcome: 'passed', finishedAt };
    }
    return { outcome, finishedAt };
  }

  /** One page in the explorer's order (limit + 1 rows: the extra says there is more). */
  async page(where: Prisma.AuditEventWhereInput, limit: number): Promise<EventPage> {
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: ORDER,
      take: limit + 1,
      select: SUMMARY_SELECT,
    });
    const page = pageOf(rows, limit);
    return { items: await this.summaries(page.items), nextCursor: page.nextCursor };
  }

  /**
   * Rows as the explorer shows them, with their words: the catalog's
   * description of each action and the names of Audit Hub's own accounts,
   * two lookups for the whole page (none when it has nothing to look up).
   */
  async summaries(rows: SummaryRow[]): Promise<EventSummary[]> {
    const pairs = new Map<string, { catalogVersionId: string; action: string }>();
    for (const row of rows) {
      if (row.catalogVersionId !== null) {
        const pair = { catalogVersionId: row.catalogVersionId, action: row.action };
        pairs.set(catalogKey(pair.catalogVersionId, pair.action), pair);
      }
    }
    const [actions, staff] = await Promise.all([
      pairs.size === 0
        ? Promise.resolve([])
        : this.prisma.catalogAction.findMany({
            where: { OR: [...pairs.values()] },
            select: { catalogVersionId: true, action: true, description: true },
          }),
      this.staffLabels(rows),
    ]);
    const labels: SummaryLabels = {
      descriptions: new Map(
        actions.map((row) => [catalogKey(row.catalogVersionId, row.action), row.description]),
      ),
      staff: staff.staff,
    };
    return rows.map((row) => toSummary(row, labels));
  }

  /** The names of Audit Hub's own accounts that act in its events among `rows`. */
  private async staffLabels(
    rows: { appId: string; actorType: string; actorId: string | null }[],
  ): Promise<Pick<SummaryLabels, 'staff'>> {
    const ids = [
      ...new Set(
        rows
          .filter((row) => row.appId === SYSTEM_APP_ID && row.actorType === 'user')
          .map((row) => row.actorId)
          .filter((id): id is string => id !== null && UUID.test(id)),
      ),
    ];
    if (ids.length === 0) return { staff: NO_LABELS.staff };
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return { staff: new Map(users.map((user) => [user.id, user.name])) };
  }

  /**
   * A search by a subject's id (actor, or the user it is about): leaves out
   * the applications where that subject is blocked after an erasure
   * (explorer/blocked.ts). Also used by exports of a search.
   */
  async blockedBy(
    user: RequestUser,
    filters: Pick<EventFilters, 'appId' | 'actorId' | 'email' | 'resourceType' | 'resourceId'>,
  ): Promise<{ apps: string[]; where: Prisma.AuditEventWhereInput[] }> {
    const subjects = [
      filters.actorId,
      filters.resourceType === 'user' ? filters.resourceId : undefined,
    ].filter((subject) => subject !== undefined);
    if (subjects.length === 0 && filters.email === undefined) return { apps: [], where: [] };
    // Only the applications searched that the caller sees: nothing is said
    // of an erasure elsewhere.
    const visible = await this.access.appFilter(user);
    const searched = (appId: string) =>
      (filters.appId === undefined || appId === filters.appId) &&
      (visible.appId === undefined || visible.appId.in.includes(appId));
    const lists = await Promise.all(subjects.map((subject) => blockedApps(this.prisma, subject)));
    const found = lists.flat().filter((block) => searched(block.appId));
    const apps = [...new Set(found.map((block) => block.appId))];
    const where: Prisma.AuditEventWhereInput[] = withoutBlocked(found);
    const byEmail = filters.email !== undefined ? filters.appId : undefined;
    if (byEmail !== undefined && filters.email !== undefined && searched(byEmail)) {
      const pseudonym = emailHmac(await this.apps.pseudonymKey(byEmail), filters.email);
      const people = await blockedWithEmail(this.prisma, [byEmail], [pseudonym], 'own');
      if (people.length > 0) {
        where.push(...withoutSubjects(people));
        if (!apps.includes(byEmail)) apps.push(byEmail);
      }
    }
    return { apps, where };
  }

  private async visibleApp(user: RequestUser, appId: string) {
    const app = await this.prisma.connectedApp.findUnique({
      where: { id: appId },
      select: { id: true, correlationEnabled: true },
    });
    if (app === null || !(await this.access.canSee(user, appId))) {
      throw new NotFoundException('Application not found');
    }
    return app;
  }

  /**
   * The same person in other visible applications with correlation on, by
   * their shared email pseudonym: the applications where they appear, and
   * their events there, never those of a subject blocked there after an
   * erasure.
   */
  private async sameSubjectElsewhere(
    user: RequestUser,
    appId: string,
    subject: string,
    blockedThrough?: Date,
  ) {
    // Of a blocked subject, only from what they did after their last erasure.
    const shared = await this.prisma.$queryRaw<{ pseudonym: string }[]>`
      SELECT DISTINCT e."actor_email_hmac_shared" AS "pseudonym" FROM "audit_events" e
      WHERE e."app_id" = ${appId}::uuid AND e."actor_id" = ${subject}
        AND e."actor_email_hmac_shared" IS NOT NULL
        AND (${blockedThrough ?? null}::timestamptz IS NULL OR e."occurred_at" > ${blockedThrough ?? null}::timestamptz)
      LIMIT 5`;
    const pseudonyms = shared.map((row) => row.pseudonym);
    if (pseudonyms.length === 0) return { apps: [], where: undefined };
    const visible = await this.access.appFilter(user);
    const others = await this.prisma.connectedApp.findMany({
      where: {
        correlationEnabled: true,
        system: false,
        id: { not: appId, ...(visible.appId === undefined ? {} : { in: visible.appId.in }) },
      },
      select: { id: true, slug: true },
    });
    if (others.length === 0) return { apps: [], where: undefined };
    const ids = others.map((app) => app.id);
    const [present, people] = await Promise.all([
      presentUnblocked(this.prisma, ids, pseudonyms),
      blockedWithEmail(this.prisma, ids, pseudonyms, 'shared'),
    ]);
    return {
      apps: others
        .filter((app) => present.includes(app.id))
        .map((app) => ({ appId: app.id, slug: app.slug })),
      where: {
        AND: [
          { appId: { in: ids }, actorEmailHmacShared: { in: pseudonyms } },
          ...withoutSubjects(people),
        ],
      } satisfies Prisma.AuditEventWhereInput,
    };
  }

  private async catalogOf(row: { appId: string; catalogVersionId: string | null; action: string }) {
    if (row.catalogVersionId === null) {
      const hub = (HUB_ACTIONS as Record<string, HubAction | undefined>)[row.action];
      return { description: hub?.spec.description ?? null, tags: [...(hub?.spec.tags ?? [])] };
    }
    const action = await this.prisma.catalogAction.findUnique({
      where: {
        catalogVersionId_action: { catalogVersionId: row.catalogVersionId, action: row.action },
      },
      select: { description: true, tags: true },
    });
    return { description: action?.description ?? null, tags: action?.tags ?? [] };
  }

  private async integrityOf(row: { appId: string; category: string; recordedAt: Date }) {
    const seal = await this.prisma.integritySeal.findFirst({
      where: {
        appId: row.appId,
        category: row.category as Prisma.IntegritySealWhereInput['category'],
        windowFrom: { lte: row.recordedAt },
        windowTo: { gt: row.recordedAt },
      },
      select: { sealNo: true, createdAt: true, sealHash: true, signature: true, keyId: true },
    });
    if (seal === null) return { sealed: false, sealNo: null, verifiedAt: null, seal: null };
    const verifications = await this.prisma.integrityVerification.findMany({
      where: { outcome: 'passed', startedAt: { gt: seal.createdAt } },
      orderBy: { finishedAt: 'desc' },
      take: 20,
      select: { scope: true, finishedAt: true },
    });
    const covering = verifications.find((run) => {
      const scope = run.scope as { appId?: string } | null;
      return scope?.appId === undefined || scope.appId === row.appId;
    });
    return {
      sealed: true,
      sealNo: seal.sealNo.toString(),
      verifiedAt: covering?.finishedAt.toISOString() ?? null,
      seal: {
        hash: hex(seal.sealHash),
        signature: Buffer.from(seal.signature).toString('base64'),
        keyId: seal.keyId,
      },
    };
  }
}

export function toSummary(row: SummaryRow, labels: SummaryLabels = NO_LABELS): EventSummary {
  return {
    id: row.id,
    eventId: row.eventId,
    appId: row.appId,
    appSlug: row.app.slug,
    recordedAt: row.recordedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    category: row.category,
    action: row.action,
    description: descriptionOf(row, labels),
    outcome: row.outcome,
    severity: row.severity,
    riskScore: row.riskScore,
    actor: {
      type: row.actorType,
      id: row.actorId,
      role: row.actorRole,
      label:
        row.personal?.actorLabel ??
        (row.actorId === null ? undefined : labels.staff.get(row.actorId)) ??
        null,
    },
    resource:
      row.resourceType === null || row.resourceId === null
        ? null
        : { type: row.resourceType, id: row.resourceId },
    requestId: row.requestId,
    httpStatus: row.httpStatus,
    clientType: row.clientType,
    country: row.geoCountry,
    ipScope: row.ipScope,
  };
}

/** Audit Hub's own words for its actions; the catalog's for an application's. */
function descriptionOf(row: SummaryRow, labels: SummaryLabels): string | null {
  if (row.catalogVersionId === null) {
    return (
      (HUB_ACTIONS as Record<string, HubAction | undefined>)[row.action]?.spec.description ?? null
    );
  }
  return labels.descriptions.get(catalogKey(row.catalogVersionId, row.action)) ?? null;
}

function actorOf(user: RequestUser) {
  return { type: 'user' as const, id: user.id, role: user.role };
}
