import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppAccessService } from '../access/app-access.service.js';
import { RuleSettingsService } from '../alerts/rule-settings.service.js';
import { Auth } from '../auth/auth.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors } from '../common/openapi/index.js';
import type { RequestUser } from '../common/types/request-user.js';
import { SOURCE_STATUSES } from './source-health.js';
import { SourceHealthService } from './source-health.service.js';

export const SourceListSchema = z.object({
  items: z.array(
    z.object({
      appId: z.uuid(),
      slug: z.string(),
      name: z.string(),
      environment: z.string(),
      /** never, disconnected, delayed, idle (heartbeats, no recent events) or active. */
      status: z.enum(SOURCE_STATUSES),
      heartbeatTimeoutSec: z.int(),
      lastHeartbeatAt: z.iso.datetime().nullable(),
      queueSize: z.int(),
      queueOldestAgeSec: z.int().nullable(),
      retrying: z.int(),
      lastEventAt: z.iso.datetime().nullable(),
      rejected15m: z.int(),
      /** Open gaps older than the coverage rule's grace, and the events they miss. */
      gaps: z.int(),
      missingEvents: z.int(),
      oldestGapAt: z.iso.datetime().nullable(),
    }),
  ),
  checkedAt: z.iso.datetime(),
});

const iso = (date: Date | null) => date?.toISOString() ?? null;

// The state of the event sources the caller may see (the SOC view): each
// active application's heartbeats, queue, latest event, refused events and
// missing ones, judged as the health rules judge them.
@ApiTags('sources')
@Controller('sources')
@Auth('admin', 'auditor', 'viewer')
export class SourcesController {
  constructor(
    private readonly sources: SourceHealthService,
    private readonly access: AppAccessService,
    private readonly settings: RuleSettingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The event sources: connected, delayed, idle, disconnected; queues, refusals and gaps',
  })
  @ApiData(SourceListSchema)
  @ApiErrors(403)
  async list(@CurrentUser() user: RequestUser): Promise<z.infer<typeof SourceListSchema>> {
    const now = new Date();
    const visible = await this.access.visibleApps(user);
    const rules = await this.settings.snapshot();
    const items = await this.sources.health({
      now,
      graceMinutes: rules.of('coverage_gap').params.graceMinutes ?? 10,
      backlogSec: rules.of('source_backlog').params.oldestAgeSeconds ?? 900,
      ...(visible === 'all' ? {} : { appIds: visible }),
    });
    return {
      items: items.map((item) => ({
        ...item,
        lastHeartbeatAt: iso(item.lastHeartbeatAt),
        lastEventAt: iso(item.lastEventAt),
        oldestGapAt: iso(item.oldestGapAt),
      })),
      checkedAt: now.toISOString(),
    };
  }
}
