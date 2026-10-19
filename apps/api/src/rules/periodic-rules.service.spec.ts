import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertsService } from '../alerts/alerts.service.js';
import type { JobRunsService } from '../integrity/job-runs.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PeriodicRulesService } from './periodic-rules.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const HORIZON = new Date('2026-10-15T12:00:00.000Z');
const IP = '203.0.113.7';
const group = (key: string, overrides: Record<string, unknown> = {}) => ({
  appId: APP,
  key,
  count: 12,
  distinct: 3,
  apps: 2,
  eventPks: ['e1', 'e2'],
  last: HORIZON,
  ...overrides,
});

/** The rules' queries in the order run() makes them, each answering `answers[i]`. */
function setup(answers: unknown[][] = []) {
  const queue = [[{ locked: true, horizon: HORIZON }], ...answers];
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve(queue.shift() ?? [])),
    ruleCursor: {
      findUnique: vi.fn(() => Promise.resolve(null as unknown)),
      upsert: vi.fn((_args: Record<string, unknown>) => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const alerts = {
    raise: vi.fn(
      (
        _tx: unknown,
        _input: {
          rule: string;
          groupKey: string;
          title: string;
          summary: unknown;
          subject?: string;
        },
      ) => Promise.resolve({ id: 'a', created: true }),
    ),
  };
  const jobs = {
    run: vi.fn(async (_job: string, work: () => Promise<unknown>) => work()),
  };
  const service = new PeriodicRulesService(
    prisma as unknown as PrismaService,
    alerts as unknown as AlertsService,
    jobs as unknown as JobRunsService,
    Buffer.alloc(32, 7),
  );
  return { tx, prisma, alerts, jobs, service };
}

describe('PeriodicRulesService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('raises one alert per group each rule found, naming addresses by their pseudonym only', async () => {
    const { tx, alerts, service } = setup([
      [group('user-9'), group('a'.repeat(64))], // failed sign-ins per account
      [group(IP, { count: 25, distinct: 12 })], // per IP: brute force and stuffing
      [group(IP, { count: 3 })], // the same IP against applications with correlation on
      [group('user-3', { count: 6 })], // bulk exports
      [], // bulk deletions
      [group('user-4', { count: 60 })], // reads of other users' data
      [group('f'.repeat(64), { distinct: 2 })], // one session, several accounts
    ]);
    const summary = await service.run();
    expect(summary).toEqual({
      brute_force_account: 2,
      brute_force_ip: 1,
      credential_stuffing: 1,
      multi_app_attack: 1,
      mass_export: 1,
      mass_read: 1,
      token_reuse: 1,
    });
    const raised = alerts.raise.mock.calls.map(([, input]) => input);
    expect(JSON.stringify(raised)).not.toContain(IP);
    expect(raised[0]).toMatchObject({
      subject: 'user-9',
      groupKey: `brute_force_account:${APP}:user-9`,
    });
    // An email's pseudonym is not a user id: no subject.
    expect(raised[1]).not.toHaveProperty('subject');
    expect(raised[2]?.groupKey).toMatch(new RegExp(`^brute_force_ip:${APP}:[0-9a-f]{16}$`));
    expect(raised[3]?.title).toBe('Sign-ins of 12 accounts failing from one address in 15 minutes');
    expect(tx.ruleCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { recordedAt: HORIZON } }),
    );
  });

  it('only alerts with evidence newer than its previous run', async () => {
    const { tx, service } = setup();
    tx.ruleCursor.findUnique.mockResolvedValueOnce({
      recordedAt: new Date(HORIZON.getTime() - 5 * 60_000),
    });
    await expect(service.run()).resolves.toEqual({});
    // since: the previous horizon, the last value of the bulk exports query.
    const exports = tx.$queryRaw.mock.calls[4] as unknown[];
    expect(exports.at(-1)).toEqual(new Date(HORIZON.getTime() - 5 * 60_000));
  });

  it('leaves the run to the instance holding the lock, and records each run as a job', async () => {
    const { tx, jobs, alerts, service } = setup();
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false, horizon: HORIZON }]);
    await service.scheduled();
    expect(jobs.run).toHaveBeenCalledWith(
      'rules_periodic',
      expect.any(Function),
      expect.any(Function),
    );
    expect(alerts.raise).not.toHaveBeenCalled();
    jobs.run.mockRejectedValueOnce(new Error('database down'));
    await service.scheduled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Periodic rules skipped'),
    );
  });

  it('runs every 5 minutes between bootstrap and shutdown', async () => {
    vi.useFakeTimers();
    const { service } = setup();
    const scheduled = vi.spyOn(service, 'scheduled').mockResolvedValue(undefined);
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scheduled).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });
});
