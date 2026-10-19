import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/auth.decorator.js';
import { ApiData, ApiErrors, ZodQuery } from '../common/openapi/index.js';
import { type PageQuery, PageQuerySchema } from '../common/pagination.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueuedWebhookSchema, WebhookDeliveryPageSchema } from './dto/webhook.schemas.js';
import { WebhookOutboxService } from './webhook-outbox.service.js';

// An application's webhooks, administrators only (docs/adr/0013): a test
// delivery, and the history of what was sent and how it went.
@ApiTags('webhooks')
@Controller('connected-apps/:id')
@Auth('admin')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apps: ConnectedAppsService,
    private readonly outbox: WebhookOutboxService,
  ) {}

  @Post('webhook-test')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Send a test webhook (ping) to the application',
    description:
      'Queued at once and sent by the worker; its outcome shows in the deliveries. 400: the application has no webhook URL.',
  })
  @ApiData(QueuedWebhookSchema, { status: 202 })
  @ApiErrors(400, 403, 404)
  async ping(@Param('id', ParseUUIDPipe) id: string) {
    await this.apps.get(id);
    const queued = await this.outbox.toApp({ appId: id, type: 'ping', data: {} });
    if (queued === undefined) throw new BadRequestException('The application has no webhook URL');
    return { id: queued };
  }

  @Get('webhook-deliveries')
  @ApiOperation({ summary: "The application's webhook deliveries, newest first" })
  @ZodQuery(PageQuerySchema)
  @ApiData(WebhookDeliveryPageSchema)
  @ApiErrors(400, 403, 404)
  async deliveries(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery) {
    await this.apps.get(id);
    const where = { appId: id };
    const [rows, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        target: row.target,
        type: row.type,
        status: row.status,
        attempts: row.attempts,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt.toISOString(),
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
