import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service.js';
import { RuleSettingsService, type RuleSettingsSnapshot } from '../alerts/rule-settings.service.js';
import { errorSummary } from '../common/logging/error-summary.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type SourceHealth, SourceHealthService } from '../sources/source-health.service.js';

export const HEALTH_INTERVAL_MS = 60_000;
const LOCK_KEY = 'rules-health';
/** Verifications looked at for failures not alerted yet. */
const INTEGRITY_LOOKBACK_MS = 2 * 86_400_000;

type Tx = Prisma.TransactionClient;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** One failure of a verification, as its sample keeps it (ids only). */
interface SampledFailure {
  appId?: unknown;
  eventPk?: unknown;
}

// The rules over the sources' state and the log's integrity
// (docs/security.md#detection-rules), every minute, one instance at a time
// (an advisory lock): a source disconnected (no heartbeat within its
// application's timeout, after one was seen), delayed (its oldest queued
// event older than the threshold), refusing events (rejections in 15
// minutes), missing events (sequence gaps older than the grace); each one
// alert while it lasts, resolved by Audit Hub itself once it clears. An idle
// source (heartbeats, no events) is never an alert: no events is not a loss.
// And each failed integrity verification: one critical alert per application
// it names (never resolved by itself), whatever ran it (the daily job, the
// CLI).
@Injectable()
export class SourceHealthRulesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rules');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly sources: SourceHealthService,
    private readonly settings: RuleSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), HEALTH_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.warn(`Health rules paused: ${errorSummary(error)}`);
    }
  }

  /** One pass at `now`; answers the alerts raised or kept open. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const settings = await this.settings.snapshot(now.getTime());
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS "locked"`;
        if (lock?.locked !== true) return 0;
        const sources = await this.sources.health({
          now,
          graceMinutes: settings.of('coverage_gap').params.graceMinutes ?? 10,
          backlogSec: settings.of('source_backlog').params.oldestAgeSeconds ?? 900,
        });
        let held = 0;
        for (const source of sources) held += await this.judge(tx, source, settings, now);
        held += await this.integrity(tx, now);
        return held;
      },
      { timeout: 60_000 },
    );
  }

  private async judge(
    tx: Tx,
    source: SourceHealth,
    settings: RuleSettingsSnapshot,
    now: Date,
  ): Promise<number> {
    const { appId, slug } = source;
    let held = 0;
    const hold = async (input: Parameters<AlertsService['condition']>[1]) => {
      if ((await this.alerts.condition(tx, input)) !== null) held += 1;
    };

    // Disconnected.
    const silent = `source_silent:${appId}`;
    if (source.status === 'disconnected' && source.lastHeartbeatAt !== null) {
      await hold({
        appId,
        rule: 'source_silent',
        severity: 'high',
        groupKey: silent,
        title: `No heartbeat from application ${slug} since ${source.lastHeartbeatAt.toISOString()}`,
        summary: {
          lastHeartbeatAt: source.lastHeartbeatAt.toISOString(),
          timeoutSeconds: source.heartbeatTimeoutSec,
          silentMinutes: minutes(now.getTime() - source.lastHeartbeatAt.getTime()),
        },
        eventPks: [],
        at: now,
      });
    } else if (source.status !== 'disconnected') {
      await this.alerts.resolveCleared(tx, silent, 'Resolved by itself: a heartbeat arrived.');
    }

    // Delayed (unknown while disconnected: the queue it reported is stale).
    const backlog = `source_backlog:${appId}`;
    if (source.status === 'delayed' && source.queueOldestAgeSec !== null) {
      await hold({
        appId,
        rule: 'source_backlog',
        severity: 'medium',
        groupKey: backlog,
        title: `Events of application ${slug} delayed: the oldest queued has waited ${String(minutes(source.queueOldestAgeSec * 1000))} minutes`,
        summary: {
          queueSize: source.queueSize,
          oldestAgeSeconds: source.queueOldestAgeSec,
          retrying: source.retrying,
          thresholdSeconds: settings.of('source_backlog').params.oldestAgeSeconds ?? 900,
        },
        eventPks: [],
        at: now,
      });
    } else if (source.status === 'active' || source.status === 'idle') {
      await this.alerts.resolveCleared(tx, backlog, 'Resolved by itself: the queue drained.');
    }

    // Refused by validation.
    const refused = `ingest_rejections:${appId}`;
    const threshold = settings.of('ingest_rejections').params.count ?? 20;
    if (source.rejected15m >= threshold) {
      await hold({
        appId,
        rule: 'ingest_rejections',
        severity: 'medium',
        groupKey: refused,
        title: `${String(source.rejected15m)} events of application ${slug} refused by validation within 15 minutes`,
        summary: {
          rejected: source.rejected15m,
          threshold,
          reasons: Object.entries(await this.sources.rejectionReasons(appId, now)).map(
            ([reason, count]) => `${reason}: ${String(count)}`,
          ),
        },
        eventPks: [],
        at: now,
      });
    } else {
      await this.alerts.resolveCleared(
        tx,
        refused,
        `Resolved by itself: fewer than ${String(threshold)} events refused in the last 15 minutes.`,
      );
    }

    // Missing from the sequence.
    const gap = `coverage_gap:${appId}`;
    if (source.gaps > 0) {
      await hold({
        appId,
        rule: 'coverage_gap',
        severity: 'high',
        groupKey: gap,
        title: `${String(source.missingEvents)} events of application ${slug} missing from its sequence`,
        summary: {
          gaps: source.gaps,
          missingEvents: source.missingEvents,
          oldestGapAt: source.oldestGapAt?.toISOString() ?? '',
          graceMinutes: settings.of('coverage_gap').params.graceMinutes ?? 10,
        },
        eventPks: [],
        at: now,
      });
    } else {
      await this.alerts.resolveCleared(tx, gap, 'Resolved by itself: the missing events arrived.');
    }
    return held;
  }

  /** A critical alert per application each failed verification names, once. */
  private async integrity(tx: Tx, now: Date): Promise<number> {
    const failed = await tx.integrityVerification.findMany({
      where: {
        outcome: 'failed',
        finishedAt: { gt: new Date(now.getTime() - INTEGRITY_LOOKBACK_MS) },
      },
      orderBy: { finishedAt: 'asc' },
      select: { id: true, failures: true, failureSample: true, finishedAt: true },
    });
    let raised = 0;
    for (const verification of failed) {
      const sample = Array.isArray(verification.failureSample)
        ? (verification.failureSample as SampledFailure[])
        : [];
      const byApp = new Map<string, string[]>();
      for (const failure of sample) {
        if (typeof failure.appId !== 'string') continue;
        const pks = byApp.get(failure.appId) ?? [];
        if (typeof failure.eventPk === 'string') pks.push(failure.eventPk);
        byApp.set(failure.appId, pks);
      }
      // Failures past the sample may be anywhere: Audit Hub's own application says so.
      if (verification.failures > sample.length || byApp.size === 0) byApp.set(SYSTEM_APP_ID, []);
      for (const [appId, eventPks] of byApp) {
        const groupKey = `integrity_failure:${appId}:${verification.id}`;
        if (await this.alerts.exists(tx, groupKey)) continue;
        const app = await tx.connectedApp.findUnique({
          where: { id: appId },
          select: { slug: true },
        });
        if (app === null) continue;
        const known = await tx.auditEvent.findMany({
          where: { id: { in: eventPks } },
          select: { id: true },
        });
        const result = await this.alerts.raise(tx, {
          appId,
          rule: 'integrity_failure',
          severity: 'critical',
          groupKey,
          title: `Integrity verification ${verification.id} failed: ${String(verification.failures)} records do not match${appId === SYSTEM_APP_ID ? '' : ` (some in ${app.slug})`}`,
          summary: {
            verificationId: verification.id,
            failures: verification.failures,
            sampled: eventPks.length,
            finishedAt: verification.finishedAt.toISOString(),
          },
          eventPks: known.map((event) => event.id),
          at: now,
        });
        if (result !== null) raised += 1;
      }
    }
    return raised;
  }
}
