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
import { Auth } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodBody, ZodQuery } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import {
  type CreateResponseActionDto,
  CreateResponseActionSchema,
  type ResponseActionListQuery,
  ResponseActionListQuerySchema,
  ResponseActionPageSchema,
  type ResponseActionResponse,
  ResponseActionSchema,
} from './dto/response-action.schemas.js';
import { ResponseActionsService } from './response-actions.service.js';

// Response actions, administrators only (docs/adr/0013): requesting and
// approving need a recent step-up (docs/adr/0012); every step is recorded.
@ApiTags('response-actions')
@Controller('response-actions')
@Auth('admin')
export class ResponseActionsController {
  constructor(
    private readonly actions: ResponseActionsService,
    private readonly hubAudit: HubAuditService,
  ) {}

  private async recorded(
    user: RequestUser,
    step: 'requested' | 'approved' | 'cancelled',
    action: ResponseActionResponse,
    req: Request,
  ): Promise<ResponseActionResponse> {
    await this.hubAudit.recordQuietly({
      action: 'hub.response_action.changed',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'response_action', id: action.id },
      details: { step, action: action.action, appId: action.appId, subject: action.subject },
      request: req,
    });
    return action;
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Ask an application to act on one of its users',
    description:
      'pending_approval when the application requires a second administrator (the default), else dispatched at once as a signed webhook. 409: the action is not accepted for the application (Audit Hub setting or its catalog), or it has no webhook URL.',
  })
  @ZodBody(CreateResponseActionSchema)
  @ApiData(ResponseActionSchema, { status: 201 })
  @ApiErrors(400, 403, 404, 409)
  @RequireRecentAuth()
  async request(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateResponseActionDto,
    @Req() req: Request,
  ) {
    return this.recorded(user, 'requested', await this.actions.request(user, body), req);
  }

  @Get()
  @ApiOperation({ summary: 'Response actions, newest first' })
  @ZodQuery(ResponseActionListQuerySchema)
  @ApiData(ResponseActionPageSchema)
  @ApiErrors(400, 403)
  list(@Query() query: ResponseActionListQuery) {
    return this.actions.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One response action' })
  @ApiData(ResponseActionSchema)
  @ApiErrors(400, 403, 404)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.actions.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve a pending response action (someone other than its requester)',
    description: '403: the requester cannot approve. 409: not waiting for approval any more.',
  })
  @ApiData(ResponseActionSchema)
  @ApiErrors(400, 403, 404, 409)
  @RequireRecentAuth()
  async approve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recorded(user, 'approved', await this.actions.approve(user, id), req);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a response action still waiting for approval' })
  @ApiData(ResponseActionSchema)
  @ApiErrors(400, 403, 404, 409)
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recorded(user, 'cancelled', await this.actions.cancel(user, id), req);
  }
}
