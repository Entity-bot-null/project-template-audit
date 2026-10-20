import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditSeverity, Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { paramsOf, RULE_CATALOG, RULES, type RuleDefinition } from './rule-catalog.js';

/** How a rule runs now: its stored settings over its defaults. */
export interface EffectiveRule {
  enabled: boolean;
  /** The administrator's severity in place of the rule's own; null: the rule's. */
  severity: AuditSeverity | null;
  params: Record<string, number>;
}

export interface RuleSettingsSnapshot {
  of(rule: string): EffectiveRule;
}

const CACHE_MS = 30_000;

/** A rule that is not in the catalog runs as it always did. */
const DEFAULT: EffectiveRule = { enabled: true, severity: null, params: {} };

// The detection rules' settings (detection_rule_settings): read by the rules
// on each pass, from a snapshot kept 30 seconds (every instance sees a change
// within that time; the instance that made it at once).
@Injectable()
export class RuleSettingsService {
  private cached: { at: number; snapshot: RuleSettingsSnapshot } | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async snapshot(now = Date.now()): Promise<RuleSettingsSnapshot> {
    if (this.cached !== undefined && now - this.cached.at < CACHE_MS) return this.cached.snapshot;
    const rows = await this.prisma.detectionRuleSetting.findMany();
    const stored = new Map(rows.map((row) => [row.rule, row]));
    const effective = new Map(
      RULE_CATALOG.map((rule) => {
        const row = stored.get(rule.id);
        return [
          rule.id,
          {
            enabled: row?.enabled ?? true,
            severity: rule.severity === null ? null : (row?.severity ?? null),
            params: paramsOf(rule, row?.params),
          } satisfies EffectiveRule,
        ];
      }),
    );
    const snapshot: RuleSettingsSnapshot = { of: (rule) => effective.get(rule) ?? DEFAULT };
    this.cached = { at: now, snapshot };
    return snapshot;
  }

  /** The catalog with each rule's settings, for the panel. */
  async list() {
    const rows = await this.prisma.detectionRuleSetting.findMany();
    const stored = new Map(rows.map((row) => [row.rule, row]));
    return RULE_CATALOG.map((rule) => view(rule, stored.get(rule.id)));
  }

  /** An administrator's change, validated against the catalog's bounds. */
  async update(
    userId: string,
    ruleId: string,
    input: { enabled: boolean; severity: AuditSeverity | null; params: Record<string, number> },
  ) {
    const rule = RULES.get(ruleId);
    if (rule === undefined) throw new NotFoundException('No such detection rule');
    if (rule.severity === null && input.severity !== null) {
      throw new BadRequestException('This rule decides its severity per detection');
    }
    for (const [name, value] of Object.entries(input.params)) {
      const param = rule.params.find((candidate) => candidate.name === name);
      if (param === undefined) throw new BadRequestException(`No parameter ${name} for ${rule.id}`);
      if (!Number.isInteger(value) || value < param.min || value > param.max) {
        throw new BadRequestException(
          `${param.label} must be a whole number from ${String(param.min)} to ${String(param.max)}`,
        );
      }
    }
    const data = {
      enabled: input.enabled,
      severity: input.severity,
      params: input.params as Prisma.InputJsonObject,
      updatedById: userId,
    };
    const row = await this.prisma.detectionRuleSetting.upsert({
      where: { rule: rule.id },
      create: { rule: rule.id, ...data },
      update: data,
    });
    this.cached = undefined;
    return view(rule, row);
  }
}

function view(
  rule: RuleDefinition,
  row:
    | {
        enabled: boolean;
        severity: AuditSeverity | null;
        params: Prisma.JsonValue;
        updatedById: string | null;
        updatedAt: Date;
      }
    | undefined,
) {
  return {
    ...rule,
    params: rule.params.map((param) => ({ ...param })),
    settings: {
      enabled: row?.enabled ?? true,
      severity: rule.severity === null ? null : (row?.severity ?? null),
      params: paramsOf(rule, row?.params),
      updatedById: row?.updatedById ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    },
  };
}
