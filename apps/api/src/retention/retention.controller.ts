import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { Auth } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import {
  type CreateLegalHoldDto,
  CreateLegalHoldSchema,
  LegalHoldSchema,
  RETENTION_CLASS_VALUES,
  ReleaseLegalHoldSchema,
  RetentionPolicySchema,
  type SetRetentionPolicyDto,
  SetRetentionPolicySchema,
} from './dto/retention.schemas.js';
import { RetentionService } from './retention.service.js';

const ClassParam = z.enum(RETENTION_CLASS_VALUES);

// Retention and legal holds, administrators only (docs/adr/0007). There is
// no route that deletes an audit record: retention does, inside the database.
// Every change needs a recent step-up and is recorded (docs/adr/0012).
@ApiTags('retention')
@Controller()
@Auth('admin')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly hubAudit: HubAuditService,
  ) {}

  @Get('connected-apps/:appId/retention')
  @ApiOperation({ summary: "An application's retention per class, with each class's minimum" })
  @ApiData(z.array(RetentionPolicySchema))
  @ApiErrors(400, 403, 404)
  policies(@Param('appId', ParseUUIDPipe) appId: string) {
    return this.retention.policies(appId);
  }

  @Put('connected-apps/:appId/retention/:class')
  @ApiOperation({
    summary: 'Set how long a class is kept for an application',
    description: '400: below the class minimum (the database refuses it too).',
  })
  @ZodBody(SetRetentionPolicySchema)
  @ApiData(z.array(RetentionPolicySchema))
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async setPolicy(
    @CurrentUser() admin: RequestUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('class') retentionClass: string,
    @Body() body: SetRetentionPolicyDto,
    @Req() req: Request,
  ) {
    const parsed = ClassParam.safeParse(retentionClass);
    if (!parsed.success) {
      throw new BadRequestException(`class: one of ${RETENTION_CLASS_VALUES.join(', ')}`);
    }
    const policies = await this.retention.setPolicy(admin.id, appId, parsed.data, body.days);
    await this.hubAudit.recordQuietly({
      action: 'hub.retention.changed',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'connected_app', id: appId },
      details: { class: parsed.data, days: body.days },
      request: req,
    });
    return policies;
  }

  @Get('connected-apps/:appId/legal-holds')
  @ApiOperation({ summary: "An application's legal holds, newest first" })
  @ApiData(z.array(LegalHoldSchema))
  @ApiErrors(400, 403, 404)
  holds(@Param('appId', ParseUUIDPipe) appId: string) {
    return this.retention.holds(appId);
  }

  @Post('legal-holds')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Place a legal hold',
    description: 'Retention and erasure skip what it matches until it is released.',
  })
  @ZodBody(CreateLegalHoldSchema)
  @ApiData(LegalHoldSchema, { status: 201 })
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async createHold(
    @CurrentUser() admin: RequestUser,
    @Body() body: CreateLegalHoldDto,
    @Req() req: Request,
  ) {
    const hold = await this.retention.createHold(admin.id, body);
    await this.recordHold(admin, hold.id, hold.appId, 'placed', req);
    return hold;
  }

  private recordHold(
    admin: RequestUser,
    holdId: string,
    appId: string,
    step: 'placed' | 'released',
    req: Request,
  ) {
    return this.hubAudit.recordQuietly({
      action: 'hub.legal_hold.changed',
      actor: { type: 'user', id: admin.id, role: admin.role },
      resource: { type: 'legal_hold', id: holdId },
      details: { step, appId },
      request: req,
    });
  }

  @Post('legal-holds/:id/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release a legal hold: retention applies again to what it kept' })
  @ZodBody(ReleaseLegalHoldSchema)
  @ApiData(LegalHoldSchema)
  @ApiErrors(400, 403, 404)
  @RequireRecentAuth()
  async release(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: z.infer<typeof ReleaseLegalHoldSchema>,
    @Req() req: Request,
  ) {
    const hold = await this.retention.releaseHold(admin.id, id, body.reason);
    await this.recordHold(admin, hold.id, hold.appId, 'released', req);
    return hold;
  }
}
