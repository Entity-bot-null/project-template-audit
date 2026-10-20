import { BadRequestException, Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, RequireRoles } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { SEVERITY_VALUES } from './dto/alert.schemas.js';
import {
  DetectionRuleListSchema,
  DetectionRuleSchema,
  EscalationPolicyListSchema,
  EscalationPolicySchema,
  type UpdateDetectionRuleDto,
  UpdateDetectionRuleSchema,
  type UpdateEscalationPolicyDto,
  UpdateEscalationPolicySchema,
} from './dto/detection.schemas.js';
import { EscalationPoliciesService } from './escalation-policies.service.js';
import { MAX_NEW_ALERTS_PER_HOUR } from './rule-catalog.js';
import { RuleSettingsService } from './rule-settings.service.js';

const SeveritySchema = z.enum(SEVERITY_VALUES);

// The detection rules and the escalation policies: read by everyone who works
// with alerts, changed by administrators only, after a step-up (turning a
// rule off or raising its threshold can hide an attack), each change in Audit
// Hub's own log.
@ApiTags('alerts')
@Controller()
@Auth('admin', 'auditor', 'viewer')
export class DetectionController {
  constructor(
    private readonly rules: RuleSettingsService,
    private readonly policies: EscalationPoliciesService,
    private readonly hubAudit: HubAuditService,
  ) {}

  @Get('detection-rules')
  @ApiOperation({
    summary: 'The detection rules: what each detects, its parameters and its settings',
  })
  @ApiData(DetectionRuleListSchema)
  @ApiErrors(403)
  async listRules() {
    return { items: await this.rules.list(), maxNewAlertsPerHour: MAX_NEW_ALERTS_PER_HOUR };
  }

  @Put('detection-rules/:rule')
  @RequireRoles('admin')
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Turn a rule on or off, give it a severity, tune its parameters',
    description:
      '400: a parameter out of its bounds, or a severity for a rule that decides its own.',
  })
  @ZodBody(UpdateDetectionRuleSchema)
  @ApiData(DetectionRuleSchema)
  @ApiErrors(400, 403, 404)
  async updateRule(
    @CurrentUser() user: RequestUser,
    @Param('rule') rule: string,
    @Body() body: UpdateDetectionRuleDto,
    @Req() req: Request,
  ) {
    const updated = await this.rules.update(user.id, rule, body);
    await this.hubAudit.record({
      action: 'hub.detection_rule.changed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'detection_rule', id: updated.id },
      details: {
        enabled: body.enabled,
        ...(body.severity === null ? {} : { severity: body.severity }),
        params: Object.keys(body.params),
      },
      request: req,
    });
    return updated;
  }

  @Get('escalation-policies')
  @ApiOperation({ summary: 'The escalation policies, per severity, and the channels available' })
  @ApiData(EscalationPolicyListSchema)
  @ApiErrors(403)
  listPolicies() {
    return this.policies.list();
  }

  @Put('escalation-policies/:severity')
  @RequireRoles('admin')
  @RequireRecentAuth()
  @ApiOperation({ summary: "Change a severity's escalation policy" })
  @ZodBody(UpdateEscalationPolicySchema)
  @ApiData(EscalationPolicySchema)
  @ApiErrors(400, 403, 404)
  async updatePolicy(
    @CurrentUser() user: RequestUser,
    @Param('severity') severity: string,
    @Body() body: UpdateEscalationPolicyDto,
    @Req() req: Request,
  ) {
    const parsed = SeveritySchema.safeParse(severity);
    if (!parsed.success) throw new BadRequestException('Not a severity');
    const updated = await this.policies.update(user.id, parsed.data, body);
    await this.hubAudit.record({
      action: 'hub.escalation_policy.changed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'escalation_policy', id: updated.severity },
      details: { ...body },
      request: req,
    });
    return updated;
  }
}
