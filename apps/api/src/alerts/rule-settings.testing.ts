import type { EffectiveRule, RuleSettingsService } from './rule-settings.service.js';

/**
 * A RuleSettingsService double for specs: every rule on with its defaults,
 * or as `overrides` says.
 */
export function ruleSettings(overrides: Record<string, Partial<EffectiveRule>> = {}) {
  const of = (rule: string): EffectiveRule => ({
    enabled: true,
    severity: null,
    params: {},
    ...overrides[rule],
  });
  return {
    snapshot: () => Promise.resolve({ of }),
  } as unknown as RuleSettingsService;
}
