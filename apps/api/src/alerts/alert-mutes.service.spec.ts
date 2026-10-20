import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessService } from '../access/app-access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { type ActiveMute, AlertMutesService, coveringMute } from './alert-mutes.service.js';

const SHOP = '0199e0b1-0000-7000-8000-0000000000a1';
const BANK = '0199e0b1-0000-7000-8000-0000000000a2';
const NOW = new Date('2026-10-20T10:00:00.000Z');
const AUDITOR = { id: '0199e0b1-0000-7000-8000-0000000000bb', role: 'auditor' as const };
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const mute = (overrides: Partial<ActiveMute> = {}): ActiveMute => ({
  id: 'm1',
  appId: SHOP,
  rule: null,
  until: later(60),
  ...overrides,
});

const muteRow = (overrides: Record<string, unknown> = {}) => ({
  id: '0199e0b1-0000-7000-8000-0000000000e1',
  appId: SHOP,
  rule: 'brute_force_ip',
  reason: 'A load test runs against the sign-in.',
  until: later(60),
  createdById: AUDITOR.id,
  createdAt: NOW,
  endedAt: null,
  endedById: null,
  app: { slug: 'shop' },
  ...overrides,
});

function setup() {
  const prisma = {
    alertMute: {
      findMany: vi.fn((_args: unknown) => Promise.resolve([] as unknown[])),
      findUnique: vi.fn((_args: unknown) => Promise.resolve(muteRow() as unknown)),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(muteRow({ ...args.data })),
      ),
      update: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve(muteRow({ ...args.data })),
      ),
    },
  };
  const access = {
    canSee: vi.fn(() => Promise.resolve(true)),
    canManage: vi.fn(() => Promise.resolve(true)),
    appFilter: vi.fn(() => Promise.resolve({ appId: { in: [SHOP] } })),
  };
  const service = new AlertMutesService(
    prisma as unknown as PrismaService,
    access as unknown as AppAccessService,
  );
  return { prisma, access, service };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('coveringMute', () => {
  it("covers a rule's alerts with its own silence or the application's, the longest one", () => {
    const mutes = [
      mute({ id: 'rule', rule: 'brute_force_ip', until: later(30) }),
      mute({ id: 'app', rule: null, until: later(90) }),
      mute({ id: 'other', appId: BANK, rule: null, until: later(500) }),
    ];
    expect(coveringMute(mutes, SHOP, 'brute_force_ip')?.id).toBe('app');
    expect(coveringMute(mutes.slice(0, 1), SHOP, 'brute_force_ip')?.id).toBe('rule');
    expect(coveringMute(mutes.slice(0, 1), SHOP, 'token_reuse')).toBeNull();
    expect(
      coveringMute(mutes, '0199e0b1-0000-7000-8000-0000000000a9', 'brute_force_ip'),
    ).toBeNull();
  });
});

describe('AlertMutesService', () => {
  it('reads only the silences in force, of the applications asked', async () => {
    const { prisma, service } = setup();
    await expect(service.active([])).resolves.toEqual([]);
    expect(prisma.alertMute.findMany).not.toHaveBeenCalled();
    await service.active([SHOP]);
    expect(prisma.alertMute.findMany).toHaveBeenCalledWith({
      where: { appId: { in: [SHOP] }, until: { gt: NOW }, endedAt: null },
      select: { id: true, appId: true, rule: true, until: true },
    });
  });

  it('silences a rule for the minutes asked, as whoever manages the application', async () => {
    const { prisma, service } = setup();
    const created = await service.create(AUDITOR, {
      appId: SHOP,
      rule: 'brute_force_ip',
      minutes: 90,
      reason: 'A load test runs against the sign-in.',
    });
    expect(prisma.alertMute.create.mock.calls[0]?.[0].data).toMatchObject({
      appId: SHOP,
      rule: 'brute_force_ip',
      until: later(90),
      createdById: AUDITOR.id,
    });
    expect(created).toMatchObject({
      appSlug: 'shop',
      active: true,
      until: later(90).toISOString(),
    });
  });

  it('refuses an application the caller does not manage, and a rule that does not exist', async () => {
    const { access, service } = setup();
    access.canManage.mockResolvedValueOnce(false);
    const input = { appId: SHOP, rule: null, minutes: 30, reason: 'Maintenance tonight.' };
    await expect(service.create(AUDITOR, input)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(AUDITOR, { ...input, rule: 'not_a_rule' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lifts a silence in force, keeping it as ended; never one already over or not managed', async () => {
    const { prisma, access, service } = setup();
    const lifted = await service.lift(AUDITOR, 'm1');
    expect(prisma.alertMute.update.mock.calls[0]?.[0].data).toEqual({
      endedAt: NOW,
      endedById: AUDITOR.id,
    });
    expect(lifted.active).toBe(false);
    prisma.alertMute.findUnique.mockResolvedValueOnce(
      muteRow({ until: new Date(NOW.getTime() - 1) }),
    );
    await expect(service.lift(AUDITOR, 'm1')).rejects.toBeInstanceOf(ConflictException);
    access.canManage.mockResolvedValueOnce(false);
    await expect(service.lift(AUDITOR, 'm1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lists the visible applications' silences, those in force first", async () => {
    const { prisma, access, service } = setup();
    prisma.alertMute.findMany.mockResolvedValueOnce([
      muteRow({ id: 'old', endedAt: NOW, endedById: AUDITOR.id }),
      muteRow({ id: 'now' }),
    ]);
    const items = await service.list(AUDITOR);
    expect(items.map((item) => [item.id, item.active])).toEqual([
      ['now', true],
      ['old', false],
    ]);
    access.canSee.mockResolvedValueOnce(false);
    await expect(service.list(AUDITOR, BANK)).resolves.toEqual([]);
  });
});
