import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { emailHmac } from 'audit-contract/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import type { LockService } from '../infrastructure/coordination/coordination.service.js';
import {
  DUE_CHECK_INTERVAL_MS,
  FIRST_DUE_CHECK_MS,
  type JobRunsService,
} from '../integrity/job-runs.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CLASS_MINIMUMS, RETENTION_CLASSES, RetentionService } from './retention.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const ADMIN = '0199e0b1-0000-7000-8000-00000000000a';
const NOW = new Date('2026-10-14T03:00:00.000Z');
const DAY_MS = 86_400_000;
const PSEUDONYM_KEY = new Uint8Array(32).fill(7);

const holdRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'hold-1',
  appId: APP,
  caseRef: 'CASE-1',
  reason: 'Litigation about account 42',
  actorId: 'user-42',
  actorEmailHmac: null,
  resourceType: null,
  resourceId: null,
  fromAt: null,
  toAt: null,
  createdById: ADMIN,
  createdAt: NOW,
  release: null,
  ...overrides,
});

/** The erasures of scope events with events left (explorer/erasure.service.ts): none by default. */
interface PendingErasure {
  id: string;
  appId: string;
}

function setup() {
  const purges: { app: unknown; cls: unknown; cutoff: unknown }[] = [];
  const pending: PendingErasure[] = [];
  const prisma = {
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('SELECT now()')) return Promise.resolve([{ now: NOW }]);
      if (sql.includes('audit_purge_ingest_exceptions')) return Promise.resolve([{ count: 4 }]);
      if (sql.includes('"erasure_runs"')) return Promise.resolve(pending);
      if (sql.includes('audit_delete_events')) {
        return Promise.resolve([{ deleted: 0, held: 0, unsealed: 0 }]);
      }
      purges.push({ app: values[0], cls: values[1], cutoff: values[2] });
      return Promise.resolve([{ count: 0 }]);
    }),
    connectedApp: { findMany: vi.fn(() => Promise.resolve([{ id: APP }])) },
    retentionPolicy: {
      findMany: vi.fn((_args?: unknown) => Promise.resolve([] as unknown[])),
      upsert: vi.fn((_args: unknown) => Promise.resolve({})),
    },
    actorDevice: { deleteMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    actorCountry: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    actorProfile: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      updateMany: vi.fn(() => Promise.resolve({ count: 2 })),
    },
    legalHold: {
      findMany: vi.fn(() => Promise.resolve([holdRow()])),
      findUnique: vi.fn(() => Promise.resolve(holdRow() as unknown)),
      findUniqueOrThrow: vi.fn(() =>
        Promise.resolve(
          holdRow({
            release: { reason: 'Case closed by court', releasedById: ADMIN, releasedAt: NOW },
          }),
        ),
      ),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(holdRow({ ...args.data, release: null })),
      ),
    },
    legalHoldRelease: { create: vi.fn(() => Promise.resolve({})) },
  };
  const locks = {
    withLock: vi.fn(async (_name: string, _ttl: number, work: () => Promise<unknown>) => ({
      acquired: true,
      result: await work(),
    })),
  };
  const jobs = {
    run: vi.fn((_job: string, work: () => Promise<unknown>) => work()),
    sweep: vi.fn(() => Promise.resolve(0)),
    due: vi.fn((_job: string, _everyMs: number) => Promise.resolve(true)),
  };
  const apps = {
    get: vi.fn((id: string) =>
      id === APP ? Promise.resolve({ id }) : Promise.reject(new NotFoundException()),
    ),
    pseudonymKey: vi.fn(() => Promise.resolve(PSEUDONYM_KEY)),
  };
  const service = new RetentionService(
    prisma as unknown as PrismaService,
    locks as unknown as LockService,
    jobs as unknown as JobRunsService,
    apps as unknown as ConnectedAppsService,
  );
  return { prisma, locks, jobs, apps, purges, pending, service };
}

describe('RetentionService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('purges every class of every application at its retention, by the database clock', async () => {
    const { prisma, jobs, purges, service } = setup();
    prisma.retentionPolicy.findMany.mockResolvedValueOnce([
      { appId: APP, class: 'security', days: 1000 },
      // Below the minimum (the database refuses to store it): the minimum wins.
      { appId: APP, class: 'system', days: 5 },
    ]);
    await expect(service.sweep('cli')).resolves.toEqual({ ingest_exceptions: 4, rule_state: 3 });
    expect(purges.map((purge) => purge.cls)).toEqual(RETENTION_CLASSES);
    const cutoffOf = (cls: string) => purges.find((purge) => purge.cls === cls)?.cutoff;
    expect(cutoffOf('security')).toEqual(new Date(NOW.getTime() - 1000 * DAY_MS));
    expect(cutoffOf('system')).toEqual(new Date(NOW.getTime() - CLASS_MINIMUMS.system * DAY_MS));
    expect(cutoffOf('location')).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    expect(jobs.sweep).toHaveBeenCalledWith(NOW);
  });

  it('purges in batches until a batch comes back short, and reports what went', async () => {
    const { prisma, service } = setup();
    let calls = 0;
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('SELECT now()')) return Promise.resolve([{ now: NOW }]);
      if (sql.includes('audit_purge_ingest_exceptions')) return Promise.resolve([{ count: 0 }]);
      if (sql.includes('"erasure_runs"')) return Promise.resolve([]);
      calls += 1;
      // The first class: one full batch, then 7.
      return Promise.resolve([{ count: calls === 1 ? 5000 : calls === 2 ? 7 : 0 }]);
    });
    prisma.actorDevice.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.actorProfile.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.sweep('job')).resolves.toEqual({ security: 5007 });
  });

  it('completes the erasures of scope events with what was sealed since, and reports it', async () => {
    const { prisma, pending, purges, service } = setup();
    pending.push({ id: 'run-1', appId: APP });
    const batches = [
      { deleted: 5000, held: 0, unsealed: 0 },
      { deleted: 6, held: 1, unsealed: 2 },
    ];
    const deletions: unknown[][] = [];
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('SELECT now()')) return Promise.resolve([{ now: NOW }]);
      if (sql.includes('audit_purge_ingest_exceptions')) return Promise.resolve([{ count: 0 }]);
      if (sql.includes('"erasure_runs"')) return Promise.resolve(pending);
      if (sql.includes('audit_delete_events')) {
        deletions.push(values);
        return Promise.resolve([batches.shift() ?? { deleted: 0, held: 0, unsealed: 0 }]);
      }
      purges.push({ app: values[0], cls: values[1], cutoff: values[2] });
      return Promise.resolve([{ count: 0 }]);
    });
    prisma.actorDevice.deleteMany.mockResolvedValueOnce({ count: 0 });
    prisma.actorProfile.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.sweep('job')).resolves.toEqual({ erased_events: 5006 });
    expect(deletions).toEqual([
      [APP, 'run-1', 5000],
      [APP, 'run-1', 5000],
    ]);
    // Retention purged every class as usual, apart from the erasures.
    expect(purges.map((purge) => purge.cls)).toEqual(RETENTION_CLASSES);
  });

  it('runs the daily sweep under a lock, as a recorded job, and survives a lock outage', async () => {
    const { locks, jobs, service } = setup();
    await service.scheduledSweep();
    expect(locks.withLock).toHaveBeenCalledWith('jobs:retention', 3_600_000, expect.any(Function));
    expect(jobs.run).toHaveBeenCalledWith('retention', expect.any(Function), expect.any(Function));

    locks.withLock.mockResolvedValueOnce({ acquired: false, result: undefined });
    await service.scheduledSweep();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'Another instance is running the retention sweep',
    );
    locks.withLock.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.scheduledSweep()).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Retention sweep skipped'),
    );
  });

  it('sweeps only when a day has passed since the last success', async () => {
    const { locks, jobs, service } = setup();
    jobs.due.mockResolvedValueOnce(false);
    await service.scheduledSweep();
    expect(locks.withLock).not.toHaveBeenCalled();
    // Done by another instance while this one waited for the lock.
    jobs.due.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await service.scheduledSweep();
    expect(jobs.run).not.toHaveBeenCalled();
    expect(jobs.due).toHaveBeenCalledWith('retention', DAY_MS);
  });

  it('checks every hour from shortly after bootstrap until shutdown', async () => {
    vi.useFakeTimers();
    const { service } = setup();
    const scheduled = vi.spyOn(service, 'scheduledSweep').mockResolvedValue(undefined);
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(FIRST_DUE_CHECK_MS);
    expect(scheduled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DUE_CHECK_INTERVAL_MS - FIRST_DUE_CHECK_MS);
    expect(scheduled).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(scheduled).toHaveBeenCalledTimes(2);
  });

  it('lists every class with its minimum, and the setting in effect', async () => {
    const { prisma, service } = setup();
    prisma.retentionPolicy.findMany.mockResolvedValueOnce([
      { appId: APP, class: 'audit', days: 400 },
    ]);
    const policies = await service.policies(APP);
    expect(policies).toHaveLength(RETENTION_CLASSES.length);
    expect(policies.find((policy) => policy.class === 'audit')).toEqual({
      class: 'audit',
      minimumDays: 365,
      days: 400,
      custom: true,
    });
    expect(policies.find((policy) => policy.class === 'security')).toEqual({
      class: 'security',
      minimumDays: 730,
      days: 730,
      custom: false,
    });
    await expect(service.policies('0199e0b1-0000-7000-8000-0000000000ff')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never sets a retention below the class minimum', async () => {
    const { prisma, service } = setup();
    await expect(service.setPolicy(ADMIN, APP, 'security', 365)).rejects.toThrow(
      new BadRequestException('days: security is kept at least 730 days'),
    );
    expect(prisma.retentionPolicy.upsert).not.toHaveBeenCalled();
    await service.setPolicy(ADMIN, APP, 'personal', 120);
    expect(prisma.retentionPolicy.upsert).toHaveBeenCalledWith({
      where: { appId_class: { appId: APP, class: 'personal' } },
      create: { appId: APP, class: 'personal', days: 120, updatedById: ADMIN },
      update: { days: 120, updatedById: ADMIN },
    });
  });

  it('places a hold by subject or by the pseudonym of an email, never the address', async () => {
    const { prisma, service } = setup();
    await expect(
      service.createHold(ADMIN, {
        appId: APP,
        caseRef: 'CASE-1',
        reason: 'Litigation about account 42',
        actorEmail: 'person@example.com',
        fromAt: '2026-01-01T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ byEmail: true, fromAt: '2026-01-01T00:00:00.000Z', release: null });
    const data = prisma.legalHold.create.mock.calls[0]?.[0].data ?? {};
    expect(data.actorEmailHmac).toBe(emailHmac(PSEUDONYM_KEY, 'person@example.com'));
    expect(JSON.stringify(data)).not.toContain('person@example.com');

    await service.createHold(ADMIN, {
      appId: APP,
      caseRef: 'CASE-2',
      reason: 'Litigation about document 7',
      resourceType: 'document',
      resourceId: 'doc-7',
      toAt: '2026-06-01T00:00:00.000Z',
    });
    expect(prisma.legalHold.create.mock.calls[1]?.[0].data).toMatchObject({
      actorId: null,
      actorEmailHmac: null,
      resourceType: 'document',
      resourceId: 'doc-7',
      fromAt: null,
      toAt: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('lists holds and releases each one once', async () => {
    const { prisma, service } = setup();
    await expect(service.holds(APP)).resolves.toEqual([
      expect.objectContaining({ id: 'hold-1', actorId: 'user-42', byEmail: false }),
    ]);
    await expect(
      service.releaseHold(ADMIN, 'hold-1', 'Case closed by court'),
    ).resolves.toMatchObject({
      release: {
        reason: 'Case closed by court',
        releasedById: ADMIN,
        releasedAt: NOW.toISOString(),
      },
    });
    expect(prisma.legalHoldRelease.create).toHaveBeenCalledWith({
      data: { holdId: 'hold-1', reason: 'Case closed by court', releasedById: ADMIN },
    });
    prisma.legalHold.findUnique.mockResolvedValueOnce(
      holdRow({ release: { reason: 'x', releasedById: ADMIN, releasedAt: NOW } }),
    );
    await expect(service.releaseHold(ADMIN, 'hold-1', 'Again, by mistake')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.legalHold.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.releaseHold(ADMIN, 'missing', 'Case closed by court'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
