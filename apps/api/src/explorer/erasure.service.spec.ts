import { Logger, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubAuditService, HubEventInput } from '../hub-audit/hub-audit.service.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { completePendingErasures, deleteEvents, ErasureService } from './erasure.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const OTHER = '0199e0b1-0000-7000-8000-000000000002';
const RUN = '0199e0b1-0000-7000-8000-0000000000e1';
const LATE_RUN = '0199e0b1-0000-7000-8000-0000000000e2';
const ADMIN = { type: 'user' as const, id: '0199e0b1-0000-7000-8000-00000000000a', role: 'admin' };

function setup() {
  const prisma = {
    connectedApp: {
      findFirst: vi.fn((_args: unknown) => Promise.resolve({ id: APP } as unknown)),
    },
    // Tagged template calls: the strings, then the values in order.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ personal_deleted: 3, location_deleted: 1, held: 2 }] as unknown[]),
    ),
  };
  const hubAudit = { recordQuietly: vi.fn((_input: HubEventInput) => Promise.resolve()) };
  const service = new ErasureService(
    prisma as unknown as PrismaService,
    hubAudit as unknown as HubAuditService,
  );
  return { prisma, hubAudit, service };
}

/** What a raw query raises past its lock_timeout, as the Prisma adapter reports it. */
const lockTimeout = () =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause: { kind: 'postgres', code: '55P03' } } },
  });

/** The SQL of a tagged-template call, its values apart. */
const sqlOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) => call?.[0].join('?') ?? '';
const valuesOf = (call: [TemplateStringsArray, ...unknown[]] | undefined) => call?.slice(1) ?? [];

describe('ErasureService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it("erases a subject's personal data in the database, and records who asked", async () => {
    const { prisma, hubAudit, service } = setup();
    const request = { ip: '203.0.113.7' } as Request;
    await expect(service.erase(APP, 'user-5', 'panel', { actor: ADMIN, request })).resolves.toEqual(
      { personalDeleted: 3, locationDeleted: 1, held: 2 },
    );
    expect(prisma.connectedApp.findFirst).toHaveBeenCalledWith({
      where: { id: APP, system: false },
      select: { id: true },
    });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0]!;
    expect(strings.join('?')).toContain('audit_erase_subject(');
    // The personal scope unless asked otherwise: the events stay, pseudonymous.
    expect(values).toEqual([APP, 'user-5', 'panel', 'personal']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(hubAudit.recordQuietly).toHaveBeenCalledWith({
      action: 'hub.subject.erased',
      actor: ADMIN,
      resource: { type: 'app_user', id: 'user-5' },
      details: { appId: APP, via: 'panel', scope: 'personal', personalDeleted: 3, held: 2 },
      request,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      `Erasure in application ${APP} (panel, personal): 3 personal and 1 location rows deleted, 0 events, 0 waiting for their seal, 2 held`,
    );
  });

  it("answers zeros when the database reports no run, and records a connector's request without one", async () => {
    const { prisma, hubAudit, service } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const actor = { type: 'service' as const, id: 'my-project' };
    await expect(service.erase(APP, 'user-5', 'connector', { actor })).resolves.toEqual({
      personalDeleted: 0,
      locationDeleted: 0,
      held: 0,
    });
    const input = hubAudit.recordQuietly.mock.calls[0]![0];
    expect(input).not.toHaveProperty('request');
    expect(input.details).toEqual({
      appId: APP,
      via: 'connector',
      scope: 'personal',
      personalDeleted: 0,
      held: 0,
    });
  });

  it("refuses an unknown application or Audit Hub's own (404), erasing nothing", async () => {
    const { prisma, hubAudit, service } = setup();
    prisma.connectedApp.findFirst.mockResolvedValueOnce(null);
    await expect(service.erase(APP, 'user-5', 'panel', { actor: ADMIN })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(hubAudit.recordQuietly).not.toHaveBeenCalled();
  });

  it("erases a subject's events too in the events scope, the sealed ones now, and says how many wait", async () => {
    const { prisma, hubAudit, service } = setup();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ run_id: RUN, personal_deleted: 3, location_deleted: 1, held: 2 }])
      // audit_delete_events: a full batch, then a short one with what is left.
      .mockResolvedValueOnce([{ deleted: 5000, held: 2, unsealed: 0 }])
      .mockResolvedValueOnce([{ deleted: 7, held: 2, unsealed: 4 }]);
    const actor = { type: 'service' as const, id: 'my-project' };
    await expect(service.erase(APP, 'user-5', 'connector', { actor }, 'events')).resolves.toEqual({
      personalDeleted: 3,
      locationDeleted: 1,
      held: 2,
      eventsDeleted: 5007,
      eventsPending: 4,
    });
    const calls = prisma.$queryRaw.mock.calls;
    expect(calls).toHaveLength(3);
    expect(valuesOf(calls[0])).toEqual([APP, 'user-5', 'connector', 'events']);
    for (const call of [calls[1], calls[2]]) {
      expect(sqlOf(call)).toContain('audit_delete_events(');
      // The erasure's own run: only its subject's events.
      expect(valuesOf(call)).toEqual([APP, RUN, 5000]);
    }
    expect(hubAudit.recordQuietly.mock.calls[0]![0].details).toEqual({
      appId: APP,
      via: 'connector',
      scope: 'events',
      personalDeleted: 3,
      held: 2,
      eventsDeleted: 5007,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      `Erasure in application ${APP} (connector, events): 3 personal and 1 location rows deleted, 5007 events, 4 waiting for their seal, 2 held`,
    );
  });

  it('counts what is left as waiting while another deletion in the application is busy', async () => {
    const { prisma, service } = setup();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ run_id: RUN, personal_deleted: 1, location_deleted: 0, held: 0 }])
      .mockRejectedValueOnce(lockTimeout())
      .mockResolvedValueOnce([{ count: 6 }]);
    await expect(
      service.erase(APP, 'user-5', 'panel', { actor: ADMIN }, 'events'),
    ).resolves.toMatchObject({ eventsDeleted: 0, eventsPending: 6 });
    const count = prisma.$queryRaw.mock.calls[2];
    expect(sqlOf(count)).toContain('NOT audit_event_held(e)');
    expect(valuesOf(count)).toEqual([APP, 'user-5', 'user-5']);
  });

  it('deletes no events when the database reports no run, even in the events scope', async () => {
    const { prisma, hubAudit, service } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.erase(APP, 'user-5', 'panel', { actor: ADMIN }, 'events'),
    ).resolves.toEqual({ personalDeleted: 0, locationDeleted: 0, held: 0 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(hubAudit.recordQuietly.mock.calls[0]![0].details).not.toHaveProperty('eventsDeleted');
  });
});

describe('deleteEvents', () => {
  it("deletes a suspended application's every event without an erasure run, a batch without a row as nothing", async () => {
    const { prisma } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(deleteEvents(prisma as unknown as PrismaService, APP, null)).resolves.toEqual({
      deleted: 0,
      held: 0,
      unsealed: 0,
      busy: false,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(valuesOf(prisma.$queryRaw.mock.calls[0])).toEqual([APP, null, 5000]);
  });

  it('stops, busy, while another deletion in the application holds the lock past its wait', async () => {
    const { prisma } = setup();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ deleted: 5000, held: 0, unsealed: 0 }])
      .mockRejectedValueOnce(lockTimeout());
    await expect(deleteEvents(prisma as unknown as PrismaService, APP, RUN)).resolves.toEqual({
      deleted: 5000,
      held: 0,
      unsealed: 0,
      busy: true,
    });
    // Any other failure is not swallowed.
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database down'));
    await expect(deleteEvents(prisma as unknown as PrismaService, APP, RUN)).rejects.toThrow(
      'database down',
    );
  });
});

describe('completePendingErasures', () => {
  it('deletes what each erasure of scope events still has to delete, and answers the total', async () => {
    const { prisma } = setup();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: RUN, appId: APP },
        { id: LATE_RUN, appId: OTHER },
      ])
      .mockResolvedValueOnce([{ deleted: 5000, held: 0, unsealed: 0 }])
      .mockResolvedValueOnce([{ deleted: 2, held: 1, unsealed: 0 }])
      .mockResolvedValueOnce([{ deleted: 9, held: 0, unsealed: 3 }]);
    await expect(completePendingErasures(prisma as unknown as PrismaService)).resolves.toBe(5011);
    const calls = prisma.$queryRaw.mock.calls;
    expect(sqlOf(calls[0])).toContain('"erasure_runs"');
    expect(sqlOf(calls[0])).toContain(`"scope" = 'events'`);
    expect(calls.slice(1).map(valuesOf)).toEqual([
      [APP, RUN, 5000],
      [APP, RUN, 5000],
      [OTHER, LATE_RUN, 5000],
    ]);
  });

  it('answers 0, deleting nothing, when no erasure is pending', async () => {
    const { prisma } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(completePendingErasures(prisma as unknown as PrismaService)).resolves.toBe(0);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
