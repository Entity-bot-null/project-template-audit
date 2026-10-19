import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import { ActivityService } from './activity.service.js';
import {
  type ClientEventBatchBody,
  ClientEventBatchBodySchema,
  ClientEventsService,
} from './client-events.service.js';
import {
  ActivityPageSchema,
  ActivityQuerySchema,
  AnsweredSecurityPromptSchema,
  ClientEventBatchResultSchema,
  PushTokenDeleteSchema,
  PushTokenSchema,
  SecurityPromptAnswerSchema,
  SecurityPromptListSchema,
  WebhookReplySchema,
} from './contract/index.js';
import {
  ApiData,
  ApiErrors,
  Auth,
  CurrentUser,
  type RequestUser,
  RouteRateLimit,
  ZodBody,
  ZodQuery,
} from './host.js';
import { type PushTokenBody, type PushTokenDeleteBody, PushService } from './push.service.js';
import { SecurityPromptsService } from './security-prompts.service.js';
import { WebhooksService } from './webhooks.service.js';

// The routes the connector adds to the project's API
// (docs/audit/connection-guide.md). While the connector is off (no AUDIT_HUB_*
// variables) every one answers 404.

@ApiTags('audit')
@Controller('audit')
export class ClientEventsController {
  constructor(private readonly events: ClientEventsService) {}

  @Post('client-events')
  @HttpCode(200)
  @Auth()
  @RouteRateLimit({ limit: 30, ttlSec: 60 })
  @ApiOperation({
    summary: "Events of the project's apps, for Audit Hub",
    description:
      'At most 50. The actor, the address and the request come from the server; the client section is marked as declared by the device. Each eventId is queued once.',
  })
  @ZodBody(ClientEventBatchBodySchema)
  @ApiData(ClientEventBatchResultSchema)
  @ApiErrors(400, 401, 404, 429)
  receive(
    @CurrentUser() user: RequestUser,
    @Body() body: ClientEventBatchBody,
    @Req() req: Request,
  ) {
    return this.events.receive(user, req, body);
  }
}

@ApiTags('audit')
@Controller('audit')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // No user: Audit Hub signs every delivery (listed in openapi.spec.ts).
  @Post('webhooks')
  @HttpCode(200)
  @ApiOperation({
    summary: "Audit Hub's webhooks",
    description:
      'Signed with the webhook secret over the canonical body, within five minutes; each delivery is handled once. 401: a wrong signature, which Audit Hub does not retry.',
  })
  @ApiData(WebhookReplySchema)
  @ApiErrors(400, 401, 404)
  async receive(@Req() req: Request) {
    return { status: await this.webhooks.receive(req) };
  }
}

@ApiTags('account')
@Controller('account')
@Auth()
export class AccountSecurityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly prompts: SecurityPromptsService,
    private readonly push: PushService,
  ) {}

  @Get('activity')
  @ApiOperation({
    summary: "My account's security: my own sign-ins and changes",
    description: 'From Audit Hub, the actions marked user-visible only, without IP addresses.',
  })
  @ZodQuery(ActivityQuerySchema)
  @ApiData(ActivityPageSchema)
  @ApiErrors(400, 401, 404, 503)
  list(@CurrentUser() user: RequestUser, @Query() query: z.infer<typeof ActivityQuerySchema>) {
    return this.activity.activity(user.id, query);
  }

  @Get('security-prompts')
  @ApiOperation({ summary: '"Was it you?": my open questions about suspicious sign-ins' })
  @ApiData(SecurityPromptListSchema)
  @ApiErrors(401, 404)
  async open(@CurrentUser() user: RequestUser) {
    return { items: await this.prompts.open(user.id) };
  }

  @Post('security-prompts/:id/answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer "Was it you?"',
    description: '`not_me` ends the sessions of the account (the project decides how).',
  })
  @ZodBody(SecurityPromptAnswerSchema)
  @ApiData(AnsweredSecurityPromptSchema)
  @ApiErrors(400, 401, 404)
  answer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: z.infer<typeof SecurityPromptAnswerSchema>,
  ) {
    return this.prompts.answer(user.id, id, body.answer);
  }

  @Put('push-token')
  @HttpCode(204)
  @RouteRateLimit({ limit: 10, ttlSec: 60 })
  @ApiOperation({
    summary: 'This phone\'s push token, for "Was it you?" (after each sign-in)',
    description:
      'The push module (AUDIT_HUB_PUSH=expo); 404 when it is off. A token belongs to one account: the last one signed in on the phone takes it.',
  })
  @ZodBody(PushTokenSchema)
  @ApiResponse({ status: 204, description: 'Registered' })
  @ApiErrors(400, 401, 404, 429)
  async registerPushToken(@CurrentUser() user: RequestUser, @Body() body: PushTokenBody) {
    await this.push.register(user, body);
  }

  @Delete('push-token')
  @HttpCode(204)
  @RouteRateLimit({ limit: 10, ttlSec: 60 })
  @ApiOperation({
    summary: "Forget this phone's push token (at sign-out)",
    description: 'Idempotent; 404 when the push module is off.',
  })
  @ZodBody(PushTokenDeleteSchema)
  @ApiResponse({ status: 204, description: 'Forgotten' })
  @ApiErrors(400, 401, 404, 429)
  async forgetPushToken(@CurrentUser() user: RequestUser, @Body() body: PushTokenDeleteBody) {
    await this.push.unregister(user, body);
  }
}
