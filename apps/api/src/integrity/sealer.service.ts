import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { errorSummary } from '../common/logging/error-summary.js';
import { observeIntegrity, type StreamGaugeValues } from '../observability/metrics.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INTEGRITY_KEYRING } from './integrity.constants.js';
import type { IntegrityKeyring } from './integrity-keys.js';
import {
  checkpointDigest,
  encodeLeaves,
  GENESIS_HASH,
  hex,
  hmac,
  sealHash,
  sha256,
} from './seal-math.js';

/**
 * How far behind now a window may end: ingest transactions are bounded to
 * 15 s (the trigger refuses any other), so nothing can still commit into a
 * window that ended 2 minutes ago (docs/adr/0008).
 */
export const SEAL_HORIZON_MS = 2 * 60_000;
/** Events per seal at most: bounds the leaves row and one transaction's work. */
export const MAX_SEAL_EVENTS = 20_000;
const SEAL_INTERVAL_MS = 60_000;
const STATS_INTERVAL_MS = 30_000;

interface Stream {
  appId: string;
  category: string;
}

interface LastSeal {
  sealNo: bigint;
  windowTo: Date;
  sealHash: Uint8Array;
}

// Seals every stream (application, category) in time windows, as a chain of
// hashes signed with AUDIT_INTEGRITY_KEY, and signs a daily checkpoint of
// every stream's head (IntegrityJobsService schedules it; docs/adr/0008).
// Each stream is sealed under a transaction-level advisory lock, so instances
// never seal one twice.
@Injectable()
export class SealerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Integrity');
  private timers: NodeJS.Timeout[] = [];
  private stats: StreamGaugeValues[] | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRITY_KEYRING) private readonly keys: IntegrityKeyring,
  ) {}

  onApplicationBootstrap(): void {
    if (this.keys.fallback) {
      this.logger.warn(
        'AUDIT_INTEGRITY_KEY is not set: seals are signed with a key derived from JWT_ACCESS_SECRET (development only; required in production).',
      );
    }
    observeIntegrity(() => this.stats);
    this.timers = [
      setInterval(() => void this.sealAll(), SEAL_INTERVAL_MS).unref(),
      setInterval(() => void this.refreshStats(), STATS_INTERVAL_MS).unref(),
    ];
    void this.refreshStats();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** One pass over every stream with events past its last seal. Answers the seals written. */
  async sealAll(): Promise<number> {
    try {
      const streams = await this.prisma.$queryRaw<Stream[]>`
        SELECT DISTINCT e."app_id" AS "appId", e."category"::text AS "category"
        FROM "audit_events" e
        WHERE e."recorded_at" >= coalesce((
          SELECT max(s."window_to") FROM "integrity_seals" s
          WHERE s."app_id" = e."app_id" AND s."category" = e."category"), '-infinity')`;
      let sealed = 0;
      for (const stream of streams) {
        while (await this.sealStream(stream)) sealed += 1;
      }
      return sealed;
    } catch (error) {
      this.logger.warn(`Sealing paused: ${errorSummary(error)}`);
      return 0;
    }
  }

  /** Seals the next window of one stream, if it holds events. True when a seal was written. */
  async sealStream(stream: Stream): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ locked: boolean; horizon: Date }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`audit-seal:${stream.appId}:${stream.category}`}, 0)) AS "locked",
                 date_trunc('milliseconds', now() - make_interval(secs => ${SEAL_HORIZON_MS / 1000})) AS "horizon"`;
        if (locked?.locked !== true) return false;
        const last = await lastSeal(tx, stream);
        const from = last?.windowTo ?? new Date(0);
        const rows = await tx.$queryRaw<
          { id: string; recordedAt: Date; contentHash: Uint8Array }[]
        >`
          SELECT "id", "recorded_at" AS "recordedAt", "content_hash" AS "contentHash"
          FROM "audit_events"
          WHERE "app_id" = ${stream.appId}::uuid AND "category" = ${stream.category}::"AuditCategory"
            AND "recorded_at" >= ${from} AND "recorded_at" < ${locked.horizon}
          ORDER BY "recorded_at", "id"
          LIMIT ${MAX_SEAL_EVENTS + 1}`;
        if (rows.length === 0) return false;
        let windowTo = locked.horizon;
        let leaves = rows;
        if (rows.length > MAX_SEAL_EVENTS) {
          // Cut by time, never inside one instant: the window ends at the
          // first event that does not fit.
          const cut = rows[MAX_SEAL_EVENTS]?.recordedAt ?? windowTo;
          leaves = rows.filter((row) => row.recordedAt < cut);
          windowTo = cut;
          if (leaves.length === 0) return false;
        }
        const first = leaves[0];
        const windowFrom = last?.windowTo ?? first?.recordedAt ?? from;
        const encoded = encodeLeaves(
          leaves.map((row) => ({ eventPk: row.id, contentHash: row.contentHash })),
        );
        const leavesDigest = sha256(encoded);
        const sealNo = (last?.sealNo ?? 0n) + 1n;
        const prevHash = last?.sealHash ?? GENESIS_HASH;
        const hash = sealHash({
          appId: stream.appId,
          category: stream.category,
          sealNo,
          windowFrom,
          windowTo,
          eventCount: leaves.length,
          leavesDigest,
          prevHash,
        });
        const seal = await tx.integritySeal.create({
          data: {
            appId: stream.appId,
            category: stream.category as Prisma.IntegritySealCreateInput['category'],
            sealNo,
            windowFrom,
            windowTo,
            eventCount: leaves.length,
            leavesDigest,
            prevHash: new Uint8Array(prevHash),
            sealHash: hash,
            keyId: this.keys.current.id,
            signature: hmac(this.keys.current.key, hash),
          },
          select: { id: true },
        });
        await tx.integritySealLeaves.create({ data: { sealId: seal.id, leaves: encoded } });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
    );
  }

  /**
   * Signs the head of every stream (`audit checkpoint` prints it, to be kept
   * outside Audit Hub). Undefined when nothing is sealed yet; throws on a
   * database error, so the job's run is recorded as failed.
   */
  async checkpoint(): Promise<{ id: string; digest: string } | undefined> {
    const heads = await this.prisma.$queryRaw<
      { appId: string; category: string; sealNo: bigint; sealHash: Uint8Array }[]
    >`
      SELECT DISTINCT ON ("app_id", "category")
        "app_id" AS "appId", "category"::text AS "category", "seal_no" AS "sealNo", "seal_hash" AS "sealHash"
      FROM "integrity_seals" ORDER BY "app_id", "category", "seal_no" DESC`;
    if (heads.length === 0) return undefined;
    const record = Object.fromEntries(
      heads.map((head) => [
        `${head.appId}:${head.category}`,
        { sealNo: head.sealNo.toString(), sealHash: hex(head.sealHash) },
      ]),
    );
    const digest = checkpointDigest(record);
    const created = await this.prisma.integrityCheckpoint.create({
      data: {
        heads: record,
        digest,
        keyId: this.keys.current.id,
        signature: hmac(this.keys.current.key, digest),
      },
      select: { id: true },
    });
    this.logger.log(`Integrity checkpoint ${created.id}: ${hex(digest)}`);
    return { id: created.id, digest: hex(digest) };
  }

  /** Age of the oldest event past its stream's last seal, per application. */
  async refreshStats(now: Date = new Date()): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<{ slug: string; oldest: Date | null }[]>`
        SELECT a."slug", min(e."recorded_at") AS "oldest"
        FROM "connected_apps" a
        LEFT JOIN "audit_events" e ON e."app_id" = a."id" AND e."recorded_at" >= coalesce((
          SELECT max(s."window_to") FROM "integrity_seals" s
          WHERE s."app_id" = e."app_id" AND s."category" = e."category"), '-infinity')
        GROUP BY a."slug"`;
      this.stats = rows.map((row) => ({
        slug: row.slug,
        unsealedAgeSeconds:
          row.oldest === null ? 0 : Math.max(0, (now.getTime() - row.oldest.getTime()) / 1000),
      }));
    } catch (error) {
      this.logger.warn(`Could not read the sealing state: ${errorSummary(error)}`);
    }
  }
}

async function lastSeal(
  tx: Prisma.TransactionClient,
  stream: Stream,
): Promise<LastSeal | undefined> {
  const seal = await tx.integritySeal.findFirst({
    where: {
      appId: stream.appId,
      category: stream.category as Prisma.IntegritySealWhereInput['category'],
    },
    orderBy: { sealNo: 'desc' },
    select: { sealNo: true, windowTo: true, sealHash: true },
  });
  return seal ?? undefined;
}
