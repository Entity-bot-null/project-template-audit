import { Injectable, Logger } from '@nestjs/common';
import { errorSummary } from '../common/logging/error-summary.js';
import { observeJobs } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The scheduled jobs whose runs are recorded (alerts fire when one stops running). */
export const RECORDED_JOBS = [
  'retention',
  'integrity_verify',
  'integrity_checkpoint',
  'rules_periodic',
] as const;
export type RecordedJob = (typeof RECORDED_JOBS)[number];

const STATS_INTERVAL_MS = 60_000;
const KEEP_RUNS_MS = 90 * 24 * 3_600_000;
/** How often the daily jobs check whether they are due (see `due`). */
export const DUE_CHECK_INTERVAL_MS = 3_600_000;
/** The first check after boot: the instance settles first. */
export const FIRST_DUE_CHECK_MS = 5 * 60_000;

// The brief's failure 3 of the old module: a "daily" cleanup that was never
// scheduled. Every run of a daily job is a row in job_runs, and a job runs
// when its last success there is a day old (`due`), checked every hour: a
// timer of 24 hours from boot never fires on instances restarted more often.
// The gauge app_job_last_success_timestamp_seconds is read from the same
// rows, so an alert sees a job that stopped running, whichever instance was
// supposed to run it.
@Injectable()
export class JobRunsService {
  private readonly logger = new Logger('Jobs');
  private lastSuccess: Map<string, number> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  /** Starts the gauges' refresh (called by the module that owns the jobs). */
  start(): void {
    observeJobs(() => this.lastSuccess);
    this.timer = setInterval(() => void this.refresh(), STATS_INTERVAL_MS).unref();
    void this.refresh();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs `work` as a recorded run of `job`; answers its result, undefined when it failed. */
  async run<T>(
    job: RecordedJob,
    work: () => Promise<T>,
    detail?: (result: T) => object,
  ): Promise<T | undefined> {
    const started = await this.prisma.jobRun.create({
      data: { job, outcome: 'running', startedAt: new Date() },
      select: { id: true },
    });
    try {
      const result = await work();
      await this.prisma.jobRun.update({
        where: { id: started.id },
        data: { outcome: 'succeeded', finishedAt: new Date(), detail: detail?.(result) ?? {} },
      });
      await this.refresh();
      return result;
    } catch (error) {
      this.logger.error(`Job ${job} failed: ${errorSummary(error)}`);
      await this.prisma.jobRun
        .update({
          where: { id: started.id },
          data: {
            outcome: 'failed',
            finishedAt: new Date(),
            detail: { error: errorSummary(error) },
          },
        })
        .catch(() => undefined);
      return undefined;
    }
  }

  /** Whether `job` last succeeded `everyMs` ago or more, or never did. */
  async due(job: RecordedJob, everyMs: number, now: Date = new Date()): Promise<boolean> {
    const last = await this.prisma.jobRun.findFirst({
      where: { job, outcome: 'succeeded' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    return last === null || now.getTime() - last.startedAt.getTime() >= everyMs;
  }

  /**
   * The time of each job's last success, for the gauges: 0 for a job that
   * never succeeded, so its alert fires too.
   */
  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.jobRun.groupBy({
        by: ['job'],
        where: { outcome: 'succeeded' },
        _max: { finishedAt: true },
      });
      const finished = new Map(rows.map((row) => [row.job, row._max.finishedAt]));
      this.lastSuccess = new Map(
        RECORDED_JOBS.map((job) => [job, (finished.get(job)?.getTime() ?? 0) / 1000] as const),
      );
    } catch (error) {
      this.logger.warn(`Could not read the job runs: ${errorSummary(error)}`);
    }
  }

  /** Runs older than 90 days go (they are bookkeeping, not audit records). */
  async sweep(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.jobRun.deleteMany({
      where: {
        startedAt: { lt: new Date(now.getTime() - KEEP_RUNS_MS) },
        outcome: { not: 'running' },
      },
    });
    return count;
  }
}
