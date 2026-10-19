import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import { RequireRecentAuth } from '../auth/recent-auth.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiData, ApiErrors, ZodQuery } from '../common/openapi/index.js';
import { type PageQuery, PageQuerySchema, pageOf } from '../common/pagination.js';
import type { RequestUser } from '../common/types/request-user.js';
import { EventFiltersSchema } from './dto/explorer.schemas.js';
import { EXPORT_ROW_CAP, ExportService } from './export.service.js';

const ExportQuerySchema = EventFiltersSchema.extend({ format: z.enum(['csv', 'jsonl']) });
type ExportQuery = z.infer<typeof ExportQuerySchema>;

const ExportJobSchema = z.object({
  id: z.uuid(),
  requestedById: z.uuid(),
  format: z.string(),
  /** running, completed, truncated (more rows than the cap), failed. */
  status: z.string(),
  rowCap: z.int(),
  rowCount: z.int().nullable(),
  /** sha-256 of the body, base64: the Content-Digest it was sent with. */
  digest: z.string().nullable(),
  /** The explorer's filters it ran with; an email or an IP only as "(given)". */
  filters: z.record(z.string(), z.unknown()),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

// Exports of the audit log, for administrators and auditors, after a recent
// step-up (docs/adr/0012). Each is an audit_access event with its digest.
@ApiTags('exports')
@Controller('exports')
@Auth('admin', 'auditor')
export class ExportsController {
  constructor(private readonly exports: ExportService) {}

  @Get('events')
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Export events as CSV or JSON Lines, streamed',
    description: `The explorer's filters; at most ${String(EXPORT_ROW_CAP)} rows (status truncated past it). No personal data. Spreadsheet formulas are neutralized. The body's digest is the Content-Digest trailer, and GET /api/exports/{Audit-Export-Id} gives it too. Needs a recent step-up.`,
  })
  @ZodQuery(ExportQuerySchema)
  @ApiProduces('text/csv', 'application/x-ndjson')
  @ApiResponse({ status: 200, description: 'The export, streamed' })
  @ApiErrors(400, 403)
  async events(
    @CurrentUser() user: RequestUser,
    @Query() query: ExportQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { format, ...filters } = query;
    await this.exports.stream(user, filters, format, req, res);
  }

  @Get()
  @ApiOperation({
    summary: 'Exports, newest first',
    description: "The caller's own; an administrator sees everyone's.",
  })
  @ZodQuery(PageQuerySchema)
  @ApiData(pageOf(ExportJobSchema))
  @ApiErrors(400, 403)
  list(@CurrentUser() user: RequestUser, @Query() page: PageQuery) {
    return this.exports.list(user, page);
  }

  @Get(':id')
  @ApiOperation({ summary: "An export's outcome: rows, status and digest" })
  @ApiData(ExportJobSchema)
  @ApiErrors(400, 403, 404)
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.get(user, id);
  }
}
