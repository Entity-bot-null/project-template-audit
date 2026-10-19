import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MIN_RETENTION_DAYS } from 'audit-contract';
import { emailHmac } from 'audit-contract/node';
import { errorSummary } from '../common/logging/error-summary.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { completePendingErasures } from '../explorer/erasure.service.js';
import { LockService } from '../infrastructure/coordination/coordination.service.js';
import {
  DUE_CHECK_INTERVAL_MS,
  FIRST_DUE_CHECK_MS,
  JobRunsService,
} from '../integrity/job-runs.service.js';
import type { RetentionClass } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateLegalHoldDto,
  LegalHoldResponse,
  RetentionPolicyResponse,
} from './dto/retention.schemas.js';

const DAY_MS = 86_400_000;
const PURGE_BATCH = 5000;

/** The minimum of every retention class, in days (the database enforces the same). */
export const CLASS_MINIMUMS: Readonly<Record<RetentionClass, number>> = {
  ...MIN_RETENTION_DAYS,
  personal: 90,
  location: 30,
};
export const RETENTION_CLASSES = Object.keys(CLASS_MINIMUMS) as RetentionClass[];

/** What a sweep removed, per class. */
export type SweepSummary = Partial<
  Record<RetentionClass | 'erased_events' | 'ingest_exceptions' | 'rule_state', number>
>;

// Retention (docs/adr/0007): a daily sweep, in the template's pattern for
// jobs (timers unref'd and LockService, with an advisory lock inside the
// database function as well; JobRunsService.due says when a day has passed
// since the last success), that deletes only through audit_purge():
// the database refuses anything inside a retention period, anything unsealed
// and anything a legal hold matches. There is no other way to delete an
// audit record: not in the API, not in the admin pages.
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Retention');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly jobs: JobRunsService,
    private readonly apps: ConnectedAppsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timers = [
      setTimeout(() => void this.scheduledSweep(), FIRST_DUE_CHECK_MS).unref(),
      setInterval(() => void this.scheduledSweep(), DUE_CHECK_INTERVAL_MS).unref(),
    ];
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** The daily run, when due: one instance at a time, recorded in job_runs. */
  async scheduledSweep(): Promise<void> {
    try {
      if (!(await this.jobs.due('retention', DAY_MS))) return;
      const outcome = await this.locks.withLock('jobs:retention', 3_600_000, async () => {
        // Another instance may have finished it while this one waited.
        if (!(await this.jobs.due('retention', DAY_MS))) return;
        await this.jobs.run(
          'retention',
          () => this.sweep('job'),
          (summary) => summary,
        );
      });
      if (!outcome.acquired) this.logger.log('Another instance is running the retention sweep');
    } catch (error) {
      this.logger.warn(`Retention sweep skipped: ${errorSummary(error)}`);
    }
  }

  /** Every application and class, purged up to its retention period. */
  sweep(trigger: 'job' | 'cli'): Promise<SweepSummary> {
    return sweepRetention(this.prisma, this.jobs, trigger, this.logger);
  }

  async policies(appId: string): Promise<RetentionPolicyResponse[]> {
    await this.apps.get(appId);
    const rows = await this.prisma.retentionPolicy.findMany({ where: { appId } });
    return RETENTION_CLASSES.map((retentionClass) => {
      const row = rows.find((candidate) => candidate.class === retentionClass);
      return {
        class: retentionClass,
        minimumDays: CLASS_MINIMUMS[retentionClass],
        days: Math.max(CLASS_MINIMUMS[retentionClass], row?.days ?? 0),
        custom: row !== undefined,
      };
    });
  }

  /** Never below the minimum: the database refuses it too (retention_policies_days_check). */
  async setPolicy(actorId: string, appId: string, retentionClass: RetentionClass, days: number) {
    await this.apps.get(appId);
    if (days < CLASS_MINIMUMS[retentionClass]) {
      throw new BadRequestException(
        `days: ${retentionClass} is kept at least ${String(CLASS_MINIMUMS[retentionClass])} days`,
      );
    }
    await this.prisma.retentionPolicy.upsert({
      where: { appId_class: { appId, class: retentionClass } },
      create: { appId, class: retentionClass, days, updatedById: actorId },
      update: { days, updatedById: actorId },
    });
    this.logger.log(
      `Retention of ${retentionClass} for ${appId} set to ${String(days)} days by ${actorId}`,
    );
    return this.policies(appId);
  }

  async holds(appId: string): Promise<LegalHoldResponse[]> {
    await this.apps.get(appId);
    const rows = await this.prisma.legalHold.findMany({
      where: { appId },
      include: { release: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toHoldResponse);
  }

  /** A legal hold: retention and erasure skip what it matches until it is released. */
  async createHold(actorId: string, input: CreateLegalHoldDto): Promise<LegalHoldResponse> {
    await this.apps.get(input.appId);
    // An email is held by its pseudonym: Audit Hub never stores the address.
    const actorEmailHmac =
      input.actorEmail === undefined
        ? null
        : emailHmac(await this.apps.pseudonymKey(input.appId), input.actorEmail);
    const row = await this.prisma.legalHold.create({
      data: {
        appId: input.appId,
        caseRef: input.caseRef,
        reason: input.reason,
        actorId: input.actorId ?? null,
        actorEmailHmac,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        fromAt: input.fromAt === undefined ? null : new Date(input.fromAt),
        toAt: input.toAt === undefined ? null : new Date(input.toAt),
        createdById: actorId,
      },
      include: { release: true },
    });
    this.logger.log(`Legal hold ${row.id} placed on ${input.appId} by ${actorId}`);
    return toHoldResponse(row);
  }

  async releaseHold(actorId: string, holdId: string, reason: string): Promise<LegalHoldResponse> {
    const hold = await this.prisma.legalHold.findUnique({
      where: { id: holdId },
      include: { release: true },
    });
    if (hold === null) throw new NotFoundException('Legal hold not found');
    if (hold.release !== null) throw new BadRequestException('The legal hold was released already');
    await this.prisma.legalHoldRelease.create({ data: { holdId, reason, releasedById: actorId } });
    this.logger.log(`Legal hold ${holdId} released by ${actorId}`);
    const released = await this.prisma.legalHold.findUniqueOrThrow({
      where: { id: holdId },
      include: { release: true },
    });
    return toHoldResponse(released);
  }
}

/**
 * The sweep itself, apart from the service so `audit retention` (the CLI) runs
 * the same code without the application.
 */
export async function sweepRetention(
  prisma: PrismaService,
  jobs: Pick<JobRunsService, 'sweep'>,
  trigger: 'job' | 'cli',
  logger: Pick<Logger, 'log'>,
): Promise<SweepSummary> {
  // The database's clock, not this process's: audit_purge refuses a cutoff
  // even a millisecond inside the retention period, as its now() reads it.
  const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
  const now = clock?.now ?? new Date();
  const summary: SweepSummary = {};
  const apps = await prisma.connectedApp.findMany({ select: { id: true } });
  const policies = await prisma.retentionPolicy.findMany();
  for (const app of apps) {
    for (const retentionClass of RETENTION_CLASSES) {
      const policy = policies.find((row) => row.appId === app.id && row.class === retentionClass);
      const days = Math.max(CLASS_MINIMUMS[retentionClass], policy?.days ?? 0);
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      let deleted = 0;
      for (;;) {
        const [row] = await prisma.$queryRaw<{ count: number }[]>`
          SELECT audit_purge(${app.id}::uuid, ${retentionClass}::"RetentionClass", ${cutoff}, ${trigger}, ${PURGE_BATCH}) AS "count"`;
        const count = row?.count ?? 0;
        deleted += count;
        if (count < PURGE_BATCH) break;
      }
      if (deleted > 0) summary[retentionClass] = deleted;
    }
  }
  // Erasures of scope events: what was sealed since they were asked.
  const erased = await completePendingErasures(prisma);
  if (erased > 0) summary.erased_events = erased;
  const [exceptions] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT audit_purge_ingest_exceptions(${new Date(now.getTime() - 90 * DAY_MS)}, 50000) AS "count"`;
  if ((exceptions?.count ?? 0) > 0) summary.ingest_exceptions = exceptions?.count ?? 0;
  const ruleState = await sweepRuleState(prisma, now);
  if (ruleState > 0) summary.rule_state = ruleState;
  await jobs.sweep(now);
  logger.log(`Retention sweep done: ${JSON.stringify(summary)}`);
  return summary;
}

/** What the rules remember about subjects: 90 days without activity, coordinates 30. */
async function sweepRuleState(prisma: PrismaService, now: Date): Promise<number> {
  const stale = new Date(now.getTime() - 90 * DAY_MS);
  const [devices, countries, profiles, located] = await Promise.all([
    prisma.actorDevice.deleteMany({ where: { lastSeenAt: { lt: stale } } }),
    prisma.actorCountry.deleteMany({ where: { lastSeenAt: { lt: stale } } }),
    prisma.actorProfile.deleteMany({ where: { lastSeenAt: { lt: stale } } }),
    prisma.actorProfile.updateMany({
      where: { lastLocationAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
      data: {
        lastLatitude: null,
        lastLongitude: null,
        lastAccuracyKm: null,
        lastLocationAt: null,
      },
    }),
  ]);
  return devices.count + countries.count + profiles.count + located.count;
}

function toHoldResponse(row: {
  id: string;
  appId: string;
  caseRef: string;
  reason: string;
  actorId: string | null;
  actorEmailHmac: string | null;
  resourceType: string | null;
  resourceId: string | null;
  fromAt: Date | null;
  toAt: Date | null;
  createdById: string;
  createdAt: Date;
  release: { reason: string; releasedById: string; releasedAt: Date } | null;
}): LegalHoldResponse {
  return {
    id: row.id,
    appId: row.appId,
    caseRef: row.caseRef,
    reason: row.reason,
    actorId: row.actorId,
    byEmail: row.actorEmailHmac !== null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    fromAt: row.fromAt?.toISOString() ?? null,
    toAt: row.toAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    release:
      row.release === null
        ? null
        : {
            reason: row.release.reason,
            releasedById: row.release.releasedById,
            releasedAt: row.release.releasedAt.toISOString(),
          },
  };
}
