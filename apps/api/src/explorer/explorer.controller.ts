import {
  BadRequestException,
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
import {
  type ErasureRequest,
  ErasureRequestSchema,
  ErasureResultSchema,
  ID_PATTERN,
  RESOURCE_TYPE_PATTERN,
} from 'audit-contract';
import type { Request } from 'express';
import type { z } from 'zod';
import { Auth, RequireRoles } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody, ZodQuery } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import {
  EventDetailSchema,
  EventPageSchema,
  type EventQuery,
  EventQuerySchema,
  type HistoryQuery,
  HistoryQuerySchema,
  OverviewSchema,
  SecurityOverviewSchema,
  SecurityQuerySchema,
  SubjectActivitySchema,
  type SubjectQuery,
  SubjectQuerySchema,
} from './dto/explorer.schemas.js';
import { ErasureService } from './erasure.service.js';
import { ExplorerService } from './explorer.service.js';

const subjectOf = (value: string) => {
  if (!ID_PATTERN.test(value)) throw new BadRequestException('subject: not an id');
  return value;
};

// The audit log as the admin pages read it (docs/design/audit-hub): the
// applications the caller may see only (an event of another answers 404);
// every read is an audit_access event of Audit Hub's own.
@ApiTags('explorer')
@Controller()
@Auth('admin', 'auditor', 'viewer')
export class ExplorerController {
  constructor(
    private readonly explorer: ExplorerService,
    private readonly erasure: ErasureService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Every visible application at a glance: activity, alerts, ingestion health',
  })
  @ApiData(OverviewSchema)
  @ApiErrors(403)
  overview(@CurrentUser() user: RequestUser) {
    return this.explorer.overview(user);
  }

  @Get('events')
  @ApiOperation({
    summary: 'Search the audit log, newest first',
    description:
      'Combinable filters; `email` is matched by its pseudonym and needs `appId`. Cursor pagination: pass `nextCursor` back as `cursor`. Every search is recorded (audit_access).',
  })
  @ZodQuery(EventQuerySchema)
  @ApiData(EventPageSchema)
  @ApiErrors(400, 403)
  search(@CurrentUser() user: RequestUser, @Query() query: EventQuery, @Req() req: Request) {
    return this.explorer.search(user, query, req);
  }

  @Get('events/:id')
  @ApiOperation({
    summary: 'One event: every section, its personal data while kept, its request, its integrity',
  })
  @ApiData(EventDetailSchema)
  @ApiErrors(400, 403, 404)
  detail(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.explorer.detail(user, id, req);
  }

  @Get('connected-apps/:appId/subjects/:subject')
  @ApiOperation({
    summary: "A user's activity in an application (360°)",
    description:
      '`acrossApps=true` adds the same person in other applications with correlation on, by email pseudonym.',
  })
  @ZodQuery(SubjectQuerySchema)
  @ApiData(SubjectActivitySchema)
  @ApiErrors(400, 403, 404)
  subject(
    @CurrentUser() user: RequestUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('subject') subject: string,
    @Query() query: SubjectQuery,
    @Req() req: Request,
  ) {
    return this.explorer.subject(user, appId, subjectOf(subject), query, req);
  }

  @Get('connected-apps/:appId/resources/:resourceType/:resource')
  @ApiOperation({ summary: "A resource's history in an application, newest first" })
  @ZodQuery(HistoryQuerySchema)
  @ApiData(EventPageSchema)
  @ApiErrors(400, 403, 404)
  resource(
    @CurrentUser() user: RequestUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('resourceType') resourceType: string,
    @Param('resource') resource: string,
    @Query() query: HistoryQuery,
    @Req() req: Request,
  ) {
    if (!RESOURCE_TYPE_PATTERN.test(resourceType) || !ID_PATTERN.test(resource)) {
      throw new BadRequestException('resource: not a type and an id');
    }
    return this.explorer.resource(user, appId, resourceType, resource, query, req);
  }

  @Get('connected-apps/:appId/security')
  @ApiOperation({
    summary:
      "An application's security: failed sign-ins, addresses, countries, a heatmap, anomalies",
  })
  @ZodQuery(SecurityQuerySchema)
  @ApiData(SecurityOverviewSchema)
  @ApiErrors(400, 403, 404)
  security(
    @CurrentUser() user: RequestUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Query() query: z.infer<typeof SecurityQuerySchema>,
    @Req() req: Request,
  ) {
    return this.explorer.security(user, appId, query.days, req);
  }

  @Post('connected-apps/:appId/subjects/:subject/erasure')
  @HttpCode(200)
  @RequireRoles('admin')
  @RequireRecentAuth()
  @ApiOperation({
    summary:
      "Erase a user's personal data in an application, or their events too (right to erasure)",
    description:
      'Scope personal (the default): deletes the satellite rows (network, device, labels, coordinates) of every event of the user, except what a legal hold keeps; the events stay, pseudonymous, and the user is blocked in the per-person views. Scope events, once the controller cancels them: the events go too, the sealed ones at once and the rest within a day (docs/security.md). Needs a recent step-up.',
  })
  @ZodBody(ErasureRequestSchema, { optional: true })
  @ApiData(ErasureResultSchema)
  @ApiErrors(400, 403, 404)
  erase(
    @CurrentUser() user: RequestUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('subject') subject: string,
    @Body() body: ErasureRequest,
    @Req() req: Request,
  ) {
    return this.erasure.erase(
      appId,
      subjectOf(subject),
      'panel',
      { actor: { type: 'user', id: user.id, role: user.role }, request: req },
      body.scope,
    );
  }
}
