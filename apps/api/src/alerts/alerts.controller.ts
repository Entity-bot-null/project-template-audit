import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { AlertsService } from './alerts.service.js';
import {
  AlertDetailSchema,
  type AlertListQuery,
  AlertListQuerySchema,
  AlertNoteSchema,
  AlertPageSchema,
  type UpdateAlertDto,
  UpdateAlertSchema,
} from './dto/alert.schemas.js';

// Security alerts of the applications the caller may see: administrators
// every one, auditors and viewers the ones assigned to them; viewers only
// read. An alert of another application answers 404, as one that does not
// exist. Alerts name the people they are about: each read is an
// audit_access event of Audit Hub's own, as the explorer's are.
@ApiTags('alerts')
@Controller('alerts')
@Auth('admin', 'auditor', 'viewer')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly hubAudit: HubAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Alerts, most recent activity first' })
  @ZodQuery(AlertListQuerySchema)
  @ApiData(AlertPageSchema)
  @ApiErrors(400, 403)
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: AlertListQuery,
    @Req() req: Request,
  ) {
    const page = await this.alerts.list(user, query);
    // A read of the people alerts are about, by name: in Audit Hub's own log.
    await this.hubAudit.record({
      action: 'hub.alerts.searched',
      actor: { type: 'user', id: user.id, role: user.role },
      details: {
        ...(query.appId === undefined ? {} : { appId: query.appId }),
        // The filter names, never their values.
        filters: Object.entries(query as Record<string, unknown>)
          .filter(([name, value]) => value !== undefined && !['limit', 'offset'].includes(name))
          .map(([name]) => name),
        results: page.items.length,
      },
      request: req,
    });
    return page;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One alert: why it fired, its evidence, its history and the events behind it',
  })
  @ApiData(AlertDetailSchema)
  @ApiErrors(400, 403, 404)
  async get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const alert = await this.alerts.get(user, id);
    await this.hubAudit.record({
      action: 'hub.alert.viewed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'alert', id },
      details: { appId: alert.appId },
      request: req,
    });
    return alert;
  }

  @Patch(':id')
  @RequireRoles('admin', 'auditor')
  @ApiOperation({
    summary: 'Change the status or the assignee of an alert',
    description:
      '409: the alert changed since `version` was read, the transition is not allowed, or the assignee cannot work on the application.',
  })
  @ZodBody(UpdateAlertSchema)
  @ApiData(AlertDetailSchema)
  @ApiErrors(400, 403, 404, 409)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAlertDto,
    @Req() req: Request,
  ) {
    const updated = await this.alerts.update(user, id, body);
    await this.hubAudit.recordQuietly({
      action: 'hub.alert.updated',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'alert', id },
      details: {
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.assigneeId === undefined || body.assigneeId === null
          ? {}
          : { assigneeId: body.assigneeId }),
      },
      request: req,
    });
    return updated;
  }

  @Post(':id/notes')
  @HttpCode(201)
  @RequireRoles('admin', 'auditor')
  @ApiOperation({ summary: 'Add a note to an alert' })
  @ZodBody(AlertNoteSchema)
  @ApiData(AlertDetailSchema, { status: 201 })
  @ApiErrors(400, 403, 404)
  async addNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: z.infer<typeof AlertNoteSchema>,
    @Req() req: Request,
  ) {
    const updated = await this.alerts.addNote(user, id, body.note);
    await this.hubAudit.recordQuietly({
      action: 'hub.alert.updated',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'alert', id },
      details: { note: true },
      request: req,
    });
    return updated;
  }
}
