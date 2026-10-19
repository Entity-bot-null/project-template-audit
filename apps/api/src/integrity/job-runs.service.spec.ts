import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { JobRunsService } from './job-runs.service.js';

function fakePrisma() {
  return {
    jobRun: {
      create: vi.fn(() => Promise.resolve({ id: 'run-1' })),
      update: vi.fn((_args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({}),
      ),
      groupBy: vi.fn(() => Promise.resolve([] as unknown[])),
      findFirst: vi.fn(() => Promise.resolve(null as unknown)),
      deleteMany: vi.fn((_args: { where: Record<string, unknown> }) =>
        Promise.resolve({ count: 3 }),
      ),
    },
  };
}

describe('JobRunsService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a successful run with its detail, then refreshes the gauges', async () => {
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    await expect(
      service.run(
        'retention',
        () => Promise.resolve({ security: 2 }),
        (summary) => summary,
      ),
    ).resolves.toEqual({ security: 2 });
    expect(prisma.jobRun.update.mock.calls[0]?.[0].data).toMatchObject({
      outcome: 'succeeded',
      detail: { security: 2 },
    });
    expect(prisma.jobRun.groupBy).toHaveBeenCalled();
    await service.run('integrity_checkpoint', () => Promise.resolve(undefined));
    expect(prisma.jobRun.update.mock.calls[1]?.[0].data).toMatchObject({ detail: {} });
  });

  it('records a failed run, with the error summary only, and answers undefined', async () => {
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    await expect(
      service.run('integrity_verify', () => Promise.reject(new Error('timeout'))),
    ).resolves.toBeUndefined();
    expect(prisma.jobRun.update.mock.calls[0]?.[0].data).toMatchObject({
      outcome: 'failed',
      detail: { error: expect.stringContaining('timeout') as unknown },
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Job integrity_verify failed'),
    );
    // Recording the failure can fail too: still no throw.
    prisma.jobRun.update.mockRejectedValueOnce(new Error('gone'));
    await expect(
      service.run('integrity_verify', () => Promise.reject(new Error('timeout'))),
    ).resolves.toBeUndefined();
  });

  it("reads each job's last success (0: never), and keeps the last reading when the database fails", async () => {
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    const finished = new Date('2026-10-14T03:00:00.000Z');
    prisma.jobRun.groupBy.mockResolvedValueOnce([
      { job: 'retention', _max: { finishedAt: finished } },
      { job: 'integrity_verify', _max: { finishedAt: null } },
    ]);
    await service.refresh();
    const read = () => (service as unknown as { lastSuccess: Map<string, number> }).lastSuccess;
    const expected = [
      ['retention', finished.getTime() / 1000],
      ['integrity_verify', 0],
      ['integrity_checkpoint', 0],
      ['rules_periodic', 0],
    ];
    expect([...read()]).toEqual(expected);
    prisma.jobRun.groupBy.mockRejectedValueOnce(new Error('timeout'));
    await service.refresh();
    expect([...read()]).toEqual(expected);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the job runs'),
    );
  });

  it('is due when the last success is as old as the period, or there is none', async () => {
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    const now = new Date('2026-10-14T12:00:00.000Z');
    await expect(service.due('retention', 86_400_000, now)).resolves.toBe(true);
    prisma.jobRun.findFirst.mockResolvedValueOnce({
      startedAt: new Date('2026-10-13T13:00:00.000Z'),
    });
    await expect(service.due('retention', 86_400_000, now)).resolves.toBe(false);
    prisma.jobRun.findFirst.mockResolvedValueOnce({
      startedAt: new Date('2026-10-13T12:00:00.000Z'),
    });
    await expect(service.due('retention', 86_400_000, now)).resolves.toBe(true);
  });

  it('forgets finished runs after 90 days', async () => {
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    const now = new Date('2026-10-14T00:00:00.000Z');
    await expect(service.sweep(now)).resolves.toBe(3);
    expect(prisma.jobRun.deleteMany.mock.calls[0]?.[0].where).toEqual({
      startedAt: { lt: new Date('2026-07-16T00:00:00.000Z') },
      outcome: { not: 'running' },
    });
  });

  it('refreshes every minute between start and stop', async () => {
    vi.useFakeTimers();
    const prisma = fakePrisma();
    const service = new JobRunsService(prisma as unknown as PrismaService);
    service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.jobRun.groupBy).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.jobRun.groupBy).toHaveBeenCalledTimes(2);
  });
});
