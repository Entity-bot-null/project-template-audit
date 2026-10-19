import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LockService } from '../infrastructure/coordination/coordination.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { IntegrityJobsService } from './integrity-jobs.service.js';
import {
  DUE_CHECK_INTERVAL_MS,
  FIRST_DUE_CHECK_MS,
  type JobRunsService,
} from './job-runs.service.js';
import type { SealerService } from './sealer.service.js';
import type { VerifierService } from './verifier.service.js';

const NOW = new Date('2026-10-14T03:00:00.000Z');
const DAY_MS = 86_400_000;

function setup() {
  const prisma = {
    integrityVerification: { findFirst: vi.fn(() => Promise.resolve(null as unknown)) },
  };
  const locks = {
    withLock: vi.fn(async (_name: string, _ttl: number, work: () => Promise<unknown>) => ({
      acquired: true,
      result: await work(),
    })),
  };
  // What each run would record as its detail.
  const details: unknown[] = [];
  const jobs = {
    run: vi.fn(
      async (_job: string, work: () => Promise<unknown>, detail?: (result: never) => object) => {
        const result = await work();
        details.push(detail?.(result as never));
        return result;
      },
    ),
    due: vi.fn((_job: string, _everyMs: number, _now?: Date) => Promise.resolve(true)),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const sealer = { checkpoint: vi.fn(() => Promise.resolve({ id: 'cp-1', digest: 'ab' })) };
  const verifier = {
    verify: vi.fn((_options: Record<string, unknown>) =>
      Promise.resolve({ id: 'ver-1', outcome: 'passed', failures: [] }),
    ),
  };
  const service = new IntegrityJobsService(
    prisma as unknown as PrismaService,
    locks as unknown as LockService,
    jobs as unknown as JobRunsService,
    sealer as unknown as SealerService,
    verifier as unknown as VerifierService,
  );
  return { prisma, locks, jobs, details, sealer, verifier, service };
}

describe('IntegrityJobsService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies everything when no full verification passed this week, then signs a checkpoint', async () => {
    const { jobs, details, locks, sealer, verifier, service } = setup();
    await service.daily(NOW);
    expect(locks.withLock).toHaveBeenCalledWith(
      'jobs:integrity',
      6 * 3_600_000,
      expect.any(Function),
    );
    expect(verifier.verify).toHaveBeenCalledWith({ trigger: 'job' });
    expect(sealer.checkpoint).toHaveBeenCalled();
    expect(jobs.run.mock.calls.map(([job]) => job)).toEqual([
      'integrity_verify',
      'integrity_checkpoint',
    ]);
    expect(details).toEqual([
      { id: 'ver-1', outcome: 'passed', failures: 0 },
      { id: 'cp-1', digest: 'ab' },
    ]);
  });

  it('verifies only what was sealed since the last pass after a recent full one', async () => {
    const { prisma, verifier, service } = setup();
    const lastPass = new Date(NOW.getTime() - DAY_MS);
    prisma.integrityVerification.findFirst
      .mockResolvedValueOnce({ finishedAt: new Date(NOW.getTime() - 3 * DAY_MS) })
      .mockResolvedValueOnce({ startedAt: lastPass });
    await service.daily(NOW);
    expect(verifier.verify).toHaveBeenCalledWith({ trigger: 'job', since: lastPass });

    prisma.integrityVerification.findFirst.mockResolvedValueOnce({
      finishedAt: new Date(NOW.getTime() - 8 * DAY_MS),
    });
    await service.daily(NOW);
    expect(verifier.verify).toHaveBeenLastCalledWith({ trigger: 'job' });
  });

  it('records an empty checkpoint before the first seal, and survives a lock outage', async () => {
    const { details, locks, sealer, service } = setup();
    sealer.checkpoint.mockResolvedValueOnce(undefined as never);
    await service.daily(NOW);
    expect(details[1]).toEqual({});

    locks.withLock.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.daily(NOW)).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Integrity jobs skipped'),
    );
  });

  it('runs only when a day has passed since the last success, checked again under the lock', async () => {
    const { jobs, locks, verifier, service } = setup();
    jobs.due.mockResolvedValueOnce(false);
    await service.daily(NOW);
    expect(locks.withLock).not.toHaveBeenCalled();
    jobs.due.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await service.daily(NOW);
    expect(locks.withLock).toHaveBeenCalledTimes(1);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(jobs.due).toHaveBeenCalledWith('integrity_verify', DAY_MS, NOW);
  });

  it('checks every hour from shortly after bootstrap until shutdown, with the job gauges', async () => {
    vi.useFakeTimers();
    const { jobs, service } = setup();
    const daily = vi.spyOn(service, 'daily').mockResolvedValue(undefined);
    service.onApplicationBootstrap();
    expect(jobs.start).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_DUE_CHECK_MS);
    expect(daily).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DUE_CHECK_INTERVAL_MS - FIRST_DUE_CHECK_MS);
    expect(daily).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    expect(jobs.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(daily).toHaveBeenCalledTimes(2);
  });
});
