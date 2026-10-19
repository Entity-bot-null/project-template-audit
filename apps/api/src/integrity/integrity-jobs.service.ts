import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { errorSummary } from '../common/logging/error-summary.js';
import { LockService } from '../infrastructure/coordination/coordination.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DUE_CHECK_INTERVAL_MS, FIRST_DUE_CHECK_MS, JobRunsService } from './job-runs.service.js';
import { SealerService } from './sealer.service.js';
import { VerifierService } from './verifier.service.js';

const DAY_MS = 86_400_000;
/** A full verification every this many days; incremental runs in between. */
const FULL_EVERY_DAYS = 7;

// The daily integrity jobs (docs/adr/0008): verify what was sealed since the
// last passed verification (everything once a week), then sign a checkpoint
// of every stream's head. They run when a day has passed since the last
// successful verification (JobRunsService.due, checked every hour). Each run
// is a job_runs row: AuditHubIntegrityCheckMissing fires when none succeeded
// for more than a day.
@Injectable()
export class IntegrityJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Integrity');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly jobs: JobRunsService,
    private readonly sealer: SealerService,
    private readonly verifier: VerifierService,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.start();
    this.timers = [
      setTimeout(() => void this.daily(), FIRST_DUE_CHECK_MS).unref(),
      setInterval(() => void this.daily(), DUE_CHECK_INTERVAL_MS).unref(),
    ];
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.jobs.stop();
  }

  /** The daily run, when due: one instance at a time. */
  async daily(now: Date = new Date()): Promise<void> {
    try {
      if (!(await this.jobs.due('integrity_verify', DAY_MS, now))) return;
      await this.locks.withLock('jobs:integrity', 6 * 3_600_000, async () => {
        // Another instance may have finished it while this one waited.
        if (!(await this.jobs.due('integrity_verify', DAY_MS, now))) return;
        await this.jobs.run(
          'integrity_verify',
          async () => this.verifier.verify({ trigger: 'job', ...(await this.since(now)) }),
          (report) => ({
            id: report.id,
            outcome: report.outcome,
            failures: report.failures.length,
          }),
        );
        await this.jobs.run(
          'integrity_checkpoint',
          () => this.sealer.checkpoint(),
          (checkpoint) => checkpoint ?? {},
        );
      });
    } catch (error) {
      this.logger.warn(`Integrity jobs skipped: ${errorSummary(error)}`);
    }
  }

  /** Incremental after a recent full pass; a full verification otherwise. */
  private async since(now: Date): Promise<{ since?: Date }> {
    const lastFull = await this.prisma.integrityVerification.findFirst({
      where: { outcome: 'passed', scope: { equals: {} } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    if (
      lastFull === null ||
      now.getTime() - lastFull.finishedAt.getTime() > FULL_EVERY_DAYS * DAY_MS
    )
      return {};
    const lastPassed = await this.prisma.integrityVerification.findFirst({
      where: { outcome: 'passed' },
      orderBy: { finishedAt: 'desc' },
      select: { startedAt: true },
    });
    return lastPassed === null ? {} : { since: lastPassed.startedAt };
  }
}
