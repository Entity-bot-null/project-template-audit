import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type Heartbeat, type HeartbeatResult, SUPPORTED_CONTRACT_VERSIONS } from 'audit-contract';
import { errorSummary } from '../common/logging/error-summary.js';
import { type ConnectedAppGaugeValues, observeConnectedApps } from '../observability/metrics.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedApp } from './ingest.types.js';

/** A missing sequence number this old raises AuditHubSequenceGap (through the gauge). */
export const GAP_GRACE_MS = 10 * 60_000;
/** Sequence numbers read per application and run: bounds the work of one pass. */
export const GAP_WINDOW = 50_000;
/** A connector instance silent this long no longer counts in the queue gauges. */
const INSTANCE_LIVE_MS = 5 * 60_000;
/** Instances silent this long are forgotten (the application's latest one is kept). */
const INSTANCE_SWEEP_MS = 24 * 3_600_000;

const GAP_INTERVAL_MS = 60_000;
const STATS_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;

/** A range of missing sequence numbers. */
export interface SeqRange {
  from: bigint;
  to: bigint;
}

/**
 * Where the sequence is complete up to, and what is missing above it, from
 * the numbers seen past `from` (sorted, unique) up to `upTo`.
 */
export function sequenceRanges(
  from: bigint,
  seen: readonly bigint[],
  upTo: bigint,
): { contiguousThrough: bigint; missing: SeqRange[] } {
  let contiguousThrough = from;
  let index = 0;
  while (index < seen.length && seen[index] === contiguousThrough + 1n) {
    contiguousThrough += 1n;
    index += 1;
  }
  const missing: SeqRange[] = [];
  let expected = contiguousThrough + 1n;
  for (; index < seen.length; index += 1) {
    const seq = seen[index] ?? 0n;
    if (seq > upTo) break;
    if (seq > expected) missing.push({ from: expected, to: seq - 1n });
    expected = seq + 1n;
  }
  return { contiguousThrough, missing };
}

const overlaps = (a: SeqRange, b: SeqRange) => a.from <= b.to && b.from <= a.to;

// Completeness of what each application sends (docs/adr/0005): heartbeats,
// the sequence's contiguous prefix and its gaps, and the gauges the alerts
// read (AuditHubAppSilent, AuditHubSequenceGap, AuditHubConnectorBacklog).
// Every pass is idempotent: two instances running it at once write the same
// result, under a transaction-level advisory lock per application.
@Injectable()
export class SequenceMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sequences');
  private timers: NodeJS.Timeout[] = [];
  private stats: ConnectedAppGaugeValues[] | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    observeConnectedApps(() => this.stats);
    this.timers = [
      setInterval(() => void this.detectGaps(), GAP_INTERVAL_MS).unref(),
      setInterval(() => void this.refreshStats(), STATS_INTERVAL_MS).unref(),
      setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS).unref(),
    ];
    void this.refreshStats();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async heartbeat(
    app: AuthenticatedApp,
    beat: Heartbeat,
    now: Date = new Date(),
  ): Promise<HeartbeatResult> {
    const data = {
      connectorName: beat.connector.name,
      connectorVersion: beat.connector.version,
      contractVersion: beat.contractVersion,
      appVersion: beat.appVersion,
      catalogVersion: beat.catalogVersion,
      queueSize: beat.queue.size,
      queueOldestAgeSec: beat.queue.oldestAgeSeconds,
      queueRetrying: beat.queue.retrying,
      discardedAtSignOut: beat.queue.discardedAtSignOut,
      lastHeartbeatAt: now,
    };
    await this.prisma.connectorInstance.upsert({
      where: { appId_instanceId: { appId: app.appId, instanceId: beat.instanceId } },
      create: { appId: app.appId, instanceId: beat.instanceId, ...data },
      update: data,
    });
    const state = await this.prisma.sequenceState.findUnique({
      where: { appId_epoch: { appId: app.appId, epoch: beat.sequenceEpoch } },
      select: { contiguousThrough: true },
    });
    const oldest = Math.min(...SUPPORTED_CONTRACT_VERSIONS);
    return {
      serverTime: now.toISOString(),
      contractVersions: [...SUPPORTED_CONTRACT_VERSIONS],
      lastContiguousSeq: Number(state?.contiguousThrough ?? 0n),
      connectorNotice:
        beat.contractVersion <= oldest && SUPPORTED_CONTRACT_VERSIONS.length > 1
          ? `Contract version ${String(beat.contractVersion)} is the oldest accepted: update the connector (pnpm connector update).`
          : null,
    };
  }

  /** One pass over every sequence with numbers above its contiguous prefix. */
  async detectGaps(now: Date = new Date()): Promise<void> {
    try {
      const states = await this.prisma.$queryRaw<{ appId: string; epoch: string }[]>`
        SELECT "app_id" AS "appId", "epoch" FROM "sequence_states" WHERE "max_seen" > "contiguous_through"
        UNION
        SELECT DISTINCT "app_id", "epoch" FROM "sequence_gaps" WHERE "closed_at" IS NULL`;
      for (const { appId, epoch } of states) await this.detectGapsOf(appId, epoch, now);
    } catch (error) {
      this.logger.warn(`Gap detection paused: ${errorSummary(error)}`);
    }
  }

  async detectGapsOf(appId: string, epoch: string, now: Date = new Date()): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`audit-gaps:${appId}:${epoch}`}, 0)) AS "locked"`;
        if (locked?.locked !== true) return;
        const state = await tx.sequenceState.findUnique({
          where: { appId_epoch: { appId, epoch } },
          select: { contiguousThrough: true, maxSeen: true },
        });
        if (state === null) return;
        const from = state.contiguousThrough;
        const upTo =
          state.maxSeen < from + BigInt(GAP_WINDOW) ? state.maxSeen : from + BigInt(GAP_WINDOW);
        const rows = await tx.$queryRaw<{ seq: bigint }[]>`
          SELECT "seq" FROM (
            SELECT "source_seq" AS "seq" FROM "audit_events"
            WHERE "app_id" = ${appId}::uuid AND "sequence_epoch" = ${epoch}::uuid AND "source_seq" > ${from}
            UNION
            SELECT "source_seq" FROM "ingest_exceptions"
            WHERE "app_id" = ${appId}::uuid AND "epoch" = ${epoch}::uuid AND "source_seq" > ${from}
          ) AS "seen" WHERE "seq" <= ${upTo} ORDER BY "seq"`;
        const { contiguousThrough, missing } = sequenceRanges(
          from,
          rows.map((row) => row.seq),
          upTo,
        );
        if (contiguousThrough !== from) {
          await tx.sequenceState.update({
            where: { appId_epoch: { appId, epoch } },
            data: { contiguousThrough },
          });
        }
        const open = await tx.sequenceGap.findMany({
          where: { appId, epoch, closedAt: null },
          select: { id: true, fromSeq: true, toSeq: true, detectedAt: true },
        });
        // An open gap that shrank is closed and its remainder reopened with
        // the original detection time, so the grace period does not restart.
        for (const gap of open) {
          const range = { from: gap.fromSeq, to: gap.toSeq };
          const still = missing.filter((candidate) => overlaps(candidate, range));
          const unchanged =
            still.length === 1 && still[0]?.from === range.from && still[0].to === range.to;
          if (unchanged) continue;
          await tx.sequenceGap.update({
            where: { id: gap.id },
            data: { closedAt: now, closedReason: 'arrived' },
          });
          for (const part of still) {
            await tx.sequenceGap.create({
              data: {
                appId,
                epoch,
                fromSeq: part.from > range.from ? part.from : range.from,
                toSeq: part.to < range.to ? part.to : range.to,
                detectedAt: gap.detectedAt,
              },
            });
          }
        }
        const covered = open.map((gap) => ({ from: gap.fromSeq, to: gap.toSeq }));
        for (const range of missing) {
          if (covered.some((gap) => overlaps(gap, range))) continue;
          await tx.sequenceGap.create({
            data: { appId, epoch, fromSeq: range.from, toSeq: range.to, detectedAt: now },
          });
          this.logger.warn(
            `Sequence gap in application ${appId}: ${String(range.from)}–${String(range.to)} of epoch ${epoch}`,
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /** The gauges' numbers, every 30 s: never the database on the scrape path. */
  async refreshStats(now: Date = new Date()): Promise<void> {
    try {
      const apps = await this.prisma.connectedApp.findMany({
        where: { system: false },
        select: { id: true, slug: true },
      });
      const instances = await this.prisma.connectorInstance.groupBy({
        by: ['appId'],
        _max: { lastHeartbeatAt: true },
      });
      const live = await this.prisma.connectorInstance.groupBy({
        by: ['appId'],
        where: { lastHeartbeatAt: { gt: new Date(now.getTime() - INSTANCE_LIVE_MS) } },
        _sum: { queueSize: true },
        _max: { queueOldestAgeSec: true },
      });
      const gaps = await this.prisma.$queryRaw<{ appId: string; missing: bigint }[]>`
        SELECT "app_id" AS "appId", SUM("to_seq" - "from_seq" + 1)::bigint AS "missing"
        FROM "sequence_gaps"
        WHERE "closed_at" IS NULL AND "detected_at" < ${new Date(now.getTime() - GAP_GRACE_MS)}
        GROUP BY "app_id"`;
      const lastBeat = new Map(instances.map((row) => [row.appId, row._max.lastHeartbeatAt]));
      const queues = new Map(live.map((row) => [row.appId, row]));
      const missing = new Map(gaps.map((row) => [row.appId, Number(row.missing)]));
      this.stats = apps.map((app) => {
        const beat = lastBeat.get(app.id) ?? null;
        const queue = queues.get(app.id);
        return {
          slug: app.slug,
          heartbeatAgeSeconds:
            beat === null ? undefined : Math.max(0, (now.getTime() - beat.getTime()) / 1000),
          queueSize: queue?._sum.queueSize ?? 0,
          queueOldestAgeSeconds: queue?._max.queueOldestAgeSec ?? 0,
          sequenceGapEvents: missing.get(app.id) ?? 0,
        };
      });
    } catch (error) {
      this.logger.warn(`Could not read the connected applications' state: ${errorSummary(error)}`);
    }
  }

  /** Expired nonces, and connector instances long silent (each application's latest stays). */
  async sweep(now: Date = new Date()): Promise<void> {
    try {
      await this.prisma.ingestNonce.deleteMany({ where: { expiresAt: { lt: now } } });
      await this.prisma.$executeRaw`
        DELETE FROM "connector_instances" AS "old"
        WHERE "old"."last_heartbeat_at" < ${new Date(now.getTime() - INSTANCE_SWEEP_MS)}
          AND EXISTS (
            SELECT 1 FROM "connector_instances" AS "newer"
            WHERE "newer"."app_id" = "old"."app_id" AND "newer"."last_heartbeat_at" > "old"."last_heartbeat_at")`;
    } catch (error) {
      this.logger.warn(`Ingestion sweep failed: ${errorSummary(error)}`);
    }
  }
}
