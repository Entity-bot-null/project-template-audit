import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IntegrityStatus } from './dto/integrity.schemas.js';
import { hex } from './seal-math.js';

// What the admin pages and `audit status` show of integrity: one query per
// part, whatever the number of events.
@Injectable()
export class IntegrityStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async status(): Promise<IntegrityStatus> {
    const streams = await this.prisma.$queryRaw<
      {
        appId: string;
        slug: string;
        category: string;
        lastSealNo: bigint | null;
        sealedThrough: Date | null;
        unsealedEvents: bigint;
      }[]
    >`
      WITH heads AS (
        SELECT DISTINCT ON ("app_id", "category") "app_id", "category", "seal_no", "window_to"
        FROM "integrity_seals" ORDER BY "app_id", "category", "seal_no" DESC
      ), streams AS (
        SELECT DISTINCT "app_id", "category" FROM "audit_events"
        UNION SELECT "app_id", "category" FROM heads
      )
      SELECT s."app_id" AS "appId", a."slug", s."category"::text AS "category",
             h."seal_no" AS "lastSealNo", h."window_to" AS "sealedThrough",
             (SELECT count(*) FROM "audit_events" e
              WHERE e."app_id" = s."app_id" AND e."category" = s."category"
                AND e."recorded_at" >= coalesce(h."window_to", '-infinity')) AS "unsealedEvents"
      FROM streams s
      JOIN "connected_apps" a ON a."id" = s."app_id"
      LEFT JOIN heads h ON h."app_id" = s."app_id" AND h."category" = s."category"
      ORDER BY a."slug", s."category"`;
    const verifications = await this.prisma.integrityVerification.findMany({
      orderBy: { finishedAt: 'desc' },
      take: 10,
    });
    const checkpoint = await this.prisma.integrityCheckpoint.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return {
      streams: streams.map((row) => ({
        appId: row.appId,
        slug: row.slug,
        category: row.category,
        lastSealNo: row.lastSealNo === null ? null : row.lastSealNo.toString(),
        sealedThrough: row.sealedThrough?.toISOString() ?? null,
        unsealedEvents: Number(row.unsealedEvents),
      })),
      verifications: verifications.map((row) => ({
        id: row.id,
        trigger: row.trigger,
        outcome: row.outcome as 'passed' | 'failed' | 'error',
        sealsChecked: row.sealsChecked,
        eventsChecked: row.eventsChecked.toString(),
        failures: row.failures,
        failureSample: (row.failureSample as Record<string, string>[] | null) ?? null,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt.toISOString(),
      })),
      lastCheckpoint:
        checkpoint === null
          ? null
          : {
              id: checkpoint.id,
              digest: hex(checkpoint.digest),
              createdAt: checkpoint.createdAt.toISOString(),
            },
    };
  }
}
