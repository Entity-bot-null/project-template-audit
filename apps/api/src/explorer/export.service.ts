import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorSummary } from '../common/logging/error-summary.js';
import type { RequestUser } from '../common/types/request-user.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import type { ExportJob, Prisma } from '../prisma/generated/client.js';
import type { PageQuery } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { afterPosition } from './cursor.js';
import type { EventFilters } from './dto/explorer.schemas.js';
import { ExplorerService } from './explorer.service.js';

/** Rows an export holds at most: past it, the export ends and says so. */
export const EXPORT_ROW_CAP = 100_000;
const BATCH = 1000;

const EXPORT_SELECT = {
  id: true,
  eventId: true,
  recordedAt: true,
  occurredAt: true,
  category: true,
  action: true,
  outcome: true,
  severity: true,
  riskScore: true,
  actorType: true,
  actorId: true,
  actorRole: true,
  resourceType: true,
  resourceId: true,
  requestId: true,
  httpMethod: true,
  httpRoute: true,
  httpStatus: true,
  clientType: true,
  geoCountry: true,
  ipScope: true,
  details: true,
  app: { select: { slug: true } },
} satisfies Prisma.AuditEventSelect;

type ExportRow = Prisma.AuditEventGetPayload<{ select: typeof EXPORT_SELECT }>;

const COLUMNS = [
  'recordedAt',
  'occurredAt',
  'app',
  'category',
  'action',
  'outcome',
  'severity',
  'riskScore',
  'actorType',
  'actorId',
  'actorRole',
  'resourceType',
  'resourceId',
  'requestId',
  'httpMethod',
  'httpRoute',
  'httpStatus',
  'clientType',
  'country',
  'ipScope',
  'eventId',
  'id',
] as const;

/** Spreadsheets run a cell that starts with these: it is prefixed with ' (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

function textOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = textOf(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The client left mid-export: nothing more to send, the job failed. */
class ClientGone extends Error {
  constructor() {
    super('The client closed the connection');
  }
}

/**
 * Waits for the client to take what was written: true once it has, false
 * when the connection closed first ('drain' never comes then).
 */
function drained(res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (taken: boolean) => () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(taken);
    };
    const onDrain = settle(true);
    const onClose = settle(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

function toJob(job: ExportJob) {
  return {
    id: job.id,
    requestedById: job.requestedById,
    format: job.format,
    status: job.status,
    /** The explorer's filters it ran with; an email or an IP only as "(given)". */
    filters: job.filters as Record<string, unknown>,
    rowCap: job.rowCap,
    rowCount: job.rowCount,
    /** sha-256 of the body, base64: the Content-Digest it was sent with. */
    digest: job.digest,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

function flatten(row: ExportRow): Record<(typeof COLUMNS)[number], unknown> {
  return {
    recordedAt: row.recordedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    app: row.app.slug,
    category: row.category,
    action: row.action,
    outcome: row.outcome,
    severity: row.severity,
    riskScore: row.riskScore,
    actorType: row.actorType,
    actorId: row.actorId,
    actorRole: row.actorRole,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    requestId: row.requestId,
    httpMethod: row.httpMethod,
    httpRoute: row.httpRoute,
    httpStatus: row.httpStatus,
    clientType: row.clientType,
    country: row.geoCountry,
    ipScope: row.ipScope,
    eventId: row.eventId,
    id: row.id,
  };
}

// Exports (docs/design/audit-hub): CSV or JSON Lines, streamed in batches,
// at most EXPORT_ROW_CAP rows, pseudonymous (no personal data: no IP, user
// agent or label). The body's SHA-256 is the Content-Digest trailer, and is
// kept with the export (export_jobs) and in its audit_access event, so a
// copy can be checked later (GET /api/exports/:id).
@Injectable()
export class ExportService {
  private readonly logger = new Logger('Exports');

  constructor(
    private readonly prisma: PrismaService,
    private readonly explorer: ExplorerService,
    private readonly hubAudit: HubAuditService,
  ) {}

  async stream(
    user: RequestUser,
    filters: EventFilters,
    format: 'csv' | 'jsonl',
    req: Request,
    res: Response,
  ): Promise<void> {
    const found = await this.explorer.whereOf(user, filters);
    // A subject blocked after an erasure is left out, as in the search.
    const where =
      found === undefined
        ? { id: { in: [] } }
        : { AND: [found, ...(await this.explorer.blockedBy(user, filters)).where] };
    const job = await this.prisma.exportJob.create({
      data: {
        requestedById: user.id,
        // The filters, an email or an IP only as "given": never personal data at rest.
        filters: {
          ...filters,
          ...(filters.email === undefined ? {} : { email: '(given)' }),
          ...(filters.ip === undefined ? {} : { ip: '(given)' }),
        },
        format,
        rowCap: EXPORT_ROW_CAP,
        status: 'running',
      },
      select: { id: true, startedAt: true },
    });
    const stamp = job.startedAt.toISOString().slice(0, 19).replaceAll(':', '-');
    res.status(200);
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    );
    res.setHeader('Content-Disposition', `attachment; filename="audit-events-${stamp}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Audit-Export-Id', job.id);
    res.setHeader('Trailer', 'Content-Digest');

    const digest = createHash('sha256');
    const write = (text: string) => {
      digest.update(text);
      return res.write(text);
    };
    let rows = 0;
    let truncated = false;
    try {
      if (format === 'csv') write(`${COLUMNS.join(',')}\r\n`);
      let position: { recordedAt: Date; id: string } | undefined;
      for (;;) {
        const take = Math.min(BATCH, EXPORT_ROW_CAP - rows);
        if (take <= 0) {
          truncated = await this.hasMore(where, position);
          break;
        }
        const batch = await this.prisma.auditEvent.findMany({
          where: { AND: [where, afterPosition(position)] },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          take,
          select: EXPORT_SELECT,
        });
        for (const row of batch) {
          const line =
            format === 'csv'
              ? `${COLUMNS.map((column) => csvCell(flatten(row)[column])).join(',')}\r\n`
              : `${JSON.stringify({ ...flatten(row), details: row.details })}\n`;
          // Back-pressure: a slow client does not make the API hold every row.
          if (!write(line) && !(await drained(res))) throw new ClientGone();
        }
        rows += batch.length;
        const last = batch.at(-1);
        if (batch.length < take || last === undefined) break;
        position = { recordedAt: last.recordedAt, id: last.id };
      }
    } catch (error) {
      if (error instanceof ClientGone) this.logger.warn(`Export ${job.id}: the client left`);
      else this.logger.error(`Export ${job.id} failed: ${errorSummary(error)}`);
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: { status: 'failed', rowCount: rows, finishedAt: new Date() },
      });
      res.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const sha = digest.digest();
    // Kept before the body ends: whoever reads the export afterwards finds it
    // finished. The body is whole either way, so a failure here is only logged.
    try {
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: truncated ? 'truncated' : 'completed',
          rowCount: rows,
          digest: sha.toString('base64'),
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Export ${job.id} not marked finished: ${errorSummary(error)}`);
    }
    await this.hubAudit.recordQuietly({
      action: 'hub.export.created',
      actor: { type: 'user', id: user.id, role: user.role },
      resource: { type: 'export', id: job.id },
      details: {
        ...(filters.appId === undefined ? {} : { appId: filters.appId }),
        format,
        rows,
        digest: sha.toString('hex'),
        filters: Object.keys(filters).filter(
          (name) => filters[name as keyof EventFilters] !== undefined,
        ),
      },
      request: req,
    });
    res.addTrailers({ 'Content-Digest': `sha-256=:${sha.toString('base64')}:` });
    res.end();
    this.logger.log(`Export ${job.id} by ${user.id}: ${String(rows)} rows (${format})`);
  }

  /** An export's outcome: whoever asked for it, or an administrator. */
  async get(user: RequestUser, id: string) {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (job === null) throw new NotFoundException('Export not found');
    if (job.requestedById !== user.id && user.role !== 'admin') {
      throw new NotFoundException('Export not found');
    }
    return toJob(job);
  }

  /** The caller's exports, newest first; an administrator's view holds everyone's. */
  async list(user: RequestUser, page: PageQuery) {
    const where: Prisma.ExportJobWhereInput =
      user.role === 'admin' ? {} : { requestedById: user.id };
    const [rows, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: page.limit,
        skip: page.offset,
      }),
      this.prisma.exportJob.count({ where }),
    ]);
    return { items: rows.map(toJob), total };
  }

  private async hasMore(
    where: Prisma.AuditEventWhereInput,
    position: { recordedAt: Date; id: string } | undefined,
  ): Promise<boolean> {
    const next = await this.prisma.auditEvent.findFirst({
      where: { AND: [where, afterPosition(position)] },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return next !== null;
  }
}
