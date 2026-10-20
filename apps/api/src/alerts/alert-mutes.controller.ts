import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import { Auth, RequireRoles } from '../auth/auth.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody, ZodQuery } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { AlertMutesService } from './alert-mutes.service.js';
import {
  AlertMuteListSchema,
  AlertMuteQuerySchema,
  AlertMuteSchema,
  type CreateAlertMuteDto,
  CreateAlertMuteSchema,
} from './dto/alert.schemas.js';

// Silences of an application's alerts: read by whoever sees the application,
// made and lifted by its administrators and auditors (404 otherwise, as for an
// application that does not exist).
@ApiTags('alerts')
@Controller('alert-mutes')
@Auth('admin', 'auditor', 'viewer')
export class AlertMutesController {
  constructor(
    private readonly mutes: AlertMutesService,
    private readonly hubAudit: HubAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Silences of alerts: those in force first, then the most recent' })
  @ZodQuery(AlertMuteQuerySchema)
  @ApiData(AlertMuteListSchema)
  @ApiErrors(400, 403)
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: z.infer<typeof AlertMuteQuerySchema>,
  ) {
    return { items: await this.mutes.list(user, query.appId) };
  }

  @Post()
  @HttpCode(201)
  @RequireRoles('admin', 'auditor')
  @ApiOperation({
    summary: "Silence an application's alerts, of one rule or all, for a while",
    description:
      "The alerts are still raised, kept and shown; email, chat, escalation and the panel's sounds and browser notices stay quiet until it ends.",
  })
  @ZodBody(CreateAlertMuteSchema)
  @ApiData(AlertMuteSchema, { status: 201 })
  @ApiErrors(400, 403, 404)
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateAlertMuteDto,
    @Req() req: Request,
  ) {
    const mute = await this.mutes.create(user, body);
    await this.hubAudit.record({
      action: 'hub.alert_mute.changed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'alert_mute', id: mute.id },
      details: {
        appId: mute.appId,
        ...(mute.rule === null ? {} : { rule: mute.rule }),
        change: 'created',
        minutes: body.minutes,
      },
      request: req,
    });
    return mute;
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequireRoles('admin', 'auditor')
  @ApiOperation({ summary: 'Lift a silence now (kept, as ended)' })
  @ApiData(AlertMuteSchema)
  @ApiErrors(400, 403, 404, 409)
  async end(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const mute = await this.mutes.lift(user, id);
    await this.hubAudit.record({
      action: 'hub.alert_mute.changed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'alert_mute', id },
      details: {
        appId: mute.appId,
        ...(mute.rule === null ? {} : { rule: mute.rule }),
        change: 'ended',
      },
      request: req,
    });
    return mute;
  }
}
