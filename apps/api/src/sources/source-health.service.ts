import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type SourceStatus, sourceStatus } from './source-health.js';

/** What Audit Hub knows of one application's source, now. */
export interface SourceRow {
  appId: string;
  slug: string;
  name: string;
  environment: string;
  heartbeatTimeoutSec: number;
  lastHeartbeatAt: Date | null;
  /** Of the instances heard from within the timeout. */
  queueSize: number;
  queueOldestAgeSec: number | null;
  retrying: number;
  lastEventAt: Date | null;
  /** Refused by validation in the last 15 minutes (retried rejections apart: never stored). */
  rejected15m: number;
  /** Open gaps older than the grace, and the events they miss. */
  gaps: number;
  missingEvents: number;
  oldestGapAt: Date | null;
}

export interface SourceHealth extends SourceRow {
  status: SourceStatus;
}

interface Raw extends Omit<SourceRow, 'missingEvents'> {
  missingEvents: bigint | number;
}

// The sources' state for the health rules (rules/source-health-rules.service.ts)
// and the SOC view (GET /api/sources): one query for every active application
// (each part read through an index: the newest heartbeat, the newest event,
// the last 15 minutes' rejections, the open gaps).
@Injectable()
export class SourceHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async rows(options: {
    now: Date;
    graceMinutes: number;
    appIds?: readonly string[];
  }): Promise<SourceRow[]> {
    const { now, graceMinutes } = options;
    const only =
      options.appIds === undefined
        ? Prisma.empty
        : Prisma.sql`AND a."id" = ANY(${[...options.appIds]}::uuid[])`;
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT a."id" AS "appId", a."slug", a."name", a."environment",
             a."heartbeat_timeout_sec" AS "heartbeatTimeoutSec",
             h."last" AS "lastHeartbeatAt", h."queueSize", h."oldest" AS "queueOldestAgeSec", h."retrying",
             (SELECT e."recorded_at" FROM "audit_events" e WHERE e."app_id" = a."id"
              ORDER BY e."recorded_at" DESC, e."id" DESC LIMIT 1) AS "lastEventAt",
             (SELECT count(*)::int FROM "ingest_exceptions" x
              WHERE x."app_id" = a."id" AND x."kind" = 'rejected'
                AND x."received_at" > ${now}::timestamptz - interval '15 minutes') AS "rejected15m",
             g."gaps", g."missing" AS "missingEvents", g."oldest" AS "oldestGapAt"
      FROM "connected_apps" a
      LEFT JOIN LATERAL (
        SELECT max(ci."last_heartbeat_at") AS "last",
               coalesce(sum(ci."queue_size") FILTER (WHERE ci."last_heartbeat_at" > ${now}::timestamptz - make_interval(secs => a."heartbeat_timeout_sec")), 0)::int AS "queueSize",
               max(ci."queue_oldest_age_sec") FILTER (WHERE ci."queue_size" > 0 AND ci."last_heartbeat_at" > ${now}::timestamptz - make_interval(secs => a."heartbeat_timeout_sec")) AS "oldest",
               coalesce(sum(ci."queue_retrying") FILTER (WHERE ci."last_heartbeat_at" > ${now}::timestamptz - make_interval(secs => a."heartbeat_timeout_sec")), 0)::int AS "retrying"
        FROM "connector_instances" ci WHERE ci."app_id" = a."id"
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS "gaps", coalesce(sum(s."to_seq" - s."from_seq" + 1), 0) AS "missing",
               min(s."detected_at") AS "oldest"
        FROM "sequence_gaps" s
        WHERE s."app_id" = a."id" AND s."closed_at" IS NULL
          AND s."detected_at" < ${now}::timestamptz - make_interval(mins => ${graceMinutes}::int)
      ) g ON true
      WHERE a."status" = 'active' AND NOT a."system" ${only}
      ORDER BY a."slug"`;
    return rows.map((row) => ({ ...row, missingEvents: Number(row.missingEvents) }));
  }

  /** Each source with its state (source-health.ts). */
  async health(options: {
    now: Date;
    graceMinutes: number;
    backlogSec: number;
    appIds?: readonly string[];
  }): Promise<SourceHealth[]> {
    const rows = await this.rows(options);
    return rows.map((row) => ({
      ...row,
      status: sourceStatus({
        now: options.now,
        lastHeartbeatAt: row.lastHeartbeatAt,
        heartbeatTimeoutSec: row.heartbeatTimeoutSec,
        queueOldestAgeSec: row.queueOldestAgeSec,
        backlogSec: options.backlogSec,
        lastEventAt: row.lastEventAt,
      }),
    }));
  }

  /** Why one application's events were refused in the last 15 minutes: the reason codes, most frequent first. */
  async rejectionReasons(appId: string, now: Date): Promise<Record<string, number>> {
    const rows = await this.prisma.ingestException.groupBy({
      by: ['reason'],
      where: { appId, kind: 'rejected', receivedAt: { gt: new Date(now.getTime() - 15 * 60_000) } },
      _count: { _all: true },
      orderBy: { _count: { reason: 'desc' } },
      take: 5,
    });
    return Object.fromEntries(rows.map((row) => [row.reason, row._count._all]));
  }
}
