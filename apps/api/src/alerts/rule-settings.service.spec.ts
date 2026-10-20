import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { paramsOf, RULE_CATALOG, RULES } from './rule-catalog.js';
import { RuleSettingsService } from './rule-settings.service.js';

const AT = new Date('2026-10-20T10:00:00.000Z');
const ADMIN = '0199e0b1-0000-7000-8000-0000000000ad';

function setup(rows: unknown[] = []) {
  const prisma = {
    detectionRuleSetting: {
      findMany: vi.fn(() => Promise.resolve(rows)),
      upsert: vi.fn((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ ...args.create, updatedAt: AT }),
      ),
    },
  };
  return { prisma, service: new RuleSettingsService(prisma as unknown as PrismaService) };
}

describe('the rule catalog', () => {
  it('describes every rule: an id, words, a kind, bounded parameters with valid defaults', () => {
    expect(new Set(RULE_CATALOG.map((rule) => rule.id)).size).toBe(RULE_CATALOG.length);
    for (const rule of RULE_CATALOG) {
      expect(rule.id).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(rule.description.length).toBeGreaterThan(40);
      expect(['realtime', 'periodic', 'health', 'integrity']).toContain(rule.kind);
      for (const param of rule.params) {
        expect(param.min).toBeLessThanOrEqual(param.default);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it('keeps the stored parameters that are valid, the defaults for the others', () => {
    const rule = RULES.get('multi_app_attack')!;
    expect(paramsOf(rule, { applications: 3, failures: 1, extra: 9 })).toEqual({
      applications: 3,
      failures: 5,
    });
    expect(paramsOf(rule, { applications: 2.5 })).toEqual({ applications: 2, failures: 5 });
    expect(paramsOf(rule, null)).toEqual({ applications: 2, failures: 5 });
    expect(paramsOf(rule, JSON.parse('{"__proto__":{"applications":9}}'))).toEqual({
      applications: 2,
      failures: 5,
    });
  });
});

describe('RuleSettingsService', () => {
  it('runs a rule without settings with its defaults, and one with settings as they say', async () => {
    const { service } = setup([
      { rule: 'brute_force_ip', enabled: false, severity: 'critical', params: { failures: 40 } },
      { rule: 'suspicious_sign_in', enabled: true, severity: 'high', params: {} },
    ]);
    const settings = await service.snapshot(0);
    expect(settings.of('brute_force_account')).toEqual({
      enabled: true,
      severity: null,
      params: { failures: 10 },
    });
    expect(settings.of('brute_force_ip')).toEqual({
      enabled: false,
      severity: 'critical',
      params: { failures: 40 },
    });
    // A rule that decides its severity per detection keeps deciding.
    expect(settings.of('suspicious_sign_in').severity).toBeNull();
    expect(settings.of('not_a_rule')).toEqual({ enabled: true, severity: null, params: {} });
  });

  it('reads the settings again after 30 seconds, and at once after a change here', async () => {
    const { prisma, service } = setup();
    await service.snapshot(0);
    await service.snapshot(29_999);
    expect(prisma.detectionRuleSetting.findMany).toHaveBeenCalledTimes(1);
    await service.snapshot(30_000);
    expect(prisma.detectionRuleSetting.findMany).toHaveBeenCalledTimes(2);
    await service.update(ADMIN, 'mass_export', {
      enabled: true,
      severity: null,
      params: { count: 8 },
    });
    await service.snapshot(30_001);
    expect(prisma.detectionRuleSetting.findMany).toHaveBeenCalledTimes(3);
  });

  it('refuses a rule it does not know, a parameter out of bounds or unknown, a severity for a deciding rule', async () => {
    const { service } = setup();
    await expect(
      service.update(ADMIN, 'not_a_rule', { enabled: true, severity: null, params: {} }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(ADMIN, 'mass_export', { enabled: true, severity: null, params: { count: 0 } }),
    ).rejects.toThrow('Exports must be a whole number from 1 to 1000');
    await expect(
      service.update(ADMIN, 'mass_export', { enabled: true, severity: null, params: { rows: 3 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(ADMIN, 'suspicious_sign_in', { enabled: true, severity: 'low', params: {} }),
    ).rejects.toThrow('decides its severity');
  });

  it('lists the catalog with the settings, who changed them and when', async () => {
    const { service } = setup([
      {
        rule: 'token_reuse',
        enabled: false,
        severity: null,
        params: { accounts: 3 },
        updatedById: ADMIN,
        updatedAt: AT,
      },
    ]);
    const rules = await service.list();
    expect(rules).toHaveLength(RULE_CATALOG.length);
    expect(rules.find((rule) => rule.id === 'token_reuse')?.settings).toEqual({
      enabled: false,
      severity: null,
      params: { accounts: 3 },
      updatedById: ADMIN,
      updatedAt: AT.toISOString(),
    });
    expect(rules.find((rule) => rule.id === 'mass_read')?.settings.updatedAt).toBeNull();
  });
});
