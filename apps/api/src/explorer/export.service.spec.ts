import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../common/types/request-user.js';
import type { HubAuditService, HubEventInput } from '../hub-audit/hub-audit.service.js';
import type { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EventFilters } from './dto/explorer.schemas.js';
import type { ExplorerService } from './explorer.service.js';
import { csvCell, EXPORT_ROW_CAP, ExportService } from './export.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const JOB = '0199e0b1-0000-7000-8000-0000000000f1';
const AUDITOR: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000b', role: 'auditor' };
const ADMIN: RequestUser = { id: '0199e0b1-0000-7000-8000-00000000000a', role: 'admin' };
const STARTED = new Date('2026-10-15T12:34:56.789Z');
const OTHER = '0199e0b1-0000-7000-8000-000000000002';
const VISIBLE: Prisma.AuditEventWhereInput = { appId: { in: [APP] } };
/** What an export reads: the visible events, less where a subject is blocked (nowhere here). */
const SCOPED: Prisma.AuditEventWhereInput = { AND: [VISIBLE] };
const REQ = { ip: '203.0.113.7' } as Request;

const HEADER =
  'recordedAt,occurredAt,app,category,action,outcome,severity,riskScore,actorType,actorId,' +
  'actorRole,resourceType,resourceId,requestId,httpMethod,httpRoute,httpStatus,clientType,' +
  'country,ipScope,eventId,id';

const id = (n: number) => `0199e0b1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const minus = (n: number) => new Date(STARTED.getTime() - n * 1000);

const exportRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: id(n),
  eventId: id(1000 + n),
  recordedAt: minus(n),
  occurredAt: minus(n + 1),
  category: 'security',
  action: 'auth.session.signed_in',
  outcome: 'success',
  severity: 'info',
  riskScore: 0,
  actorType: 'user',
  actorId: 'user-1',
  actorRole: 'member',
  resourceType: null,
  resourceId: null,
  requestId: 'req-1',
  httpMethod: 'POST',
  httpRoute: '/api/sessions',
  httpStatus: 201,
  clientType: 'web',
  geoCountry: null,
  ipScope: 'public',
  details: { method: 'password' },
  app: { slug: 'my-project' },
  ...overrides,
});

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: JOB,
  requestedById: AUDITOR.id,
  filters: { appId: APP },
  format: 'csv',
  rowCap: EXPORT_ROW_CAP,
  status: 'completed',
  rowCount: 2,
  digest: 'c2hhLTI1Ng==',
  startedAt: STARTED,
  finishedAt: new Date(STARTED.getTime() + 1500),
  ...overrides,
});

/** The parts of Express's Response an export uses, recording what was sent. */
function fakeResponse() {
  const chunks: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    status: vi.fn((_code: number) => undefined),
    setHeader: vi.fn((_name: string, _value: string) => undefined),
    // true: buffered, the client keeps up (false asks the writer to wait for 'drain').
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    addTrailers: vi.fn((_trailers: Record<string, string>) => undefined),
    end: vi.fn(() => undefined),
    destroy: vi.fn((_error: Error) => undefined),
  });
  return { res, chunks, body: () => chunks.join('') };
}

function setup() {
  const prisma = {
    exportJob: {
      create: vi.fn((_args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: JOB, startedAt: STARTED }),
      ),
      update: vi.fn((_args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({}),
      ),
      findUnique: vi.fn((_args: unknown) => Promise.resolve(jobRow() as unknown)),
      findMany: vi.fn((_args: unknown) => Promise.resolve([jobRow()] as unknown[])),
      count: vi.fn((_args: unknown) => Promise.resolve(1)),
    },
    auditEvent: {
      findMany: vi.fn((_args: { where: Record<string, unknown>; take: number }) =>
        Promise.resolve([exportRow(1), exportRow(2)] as unknown[]),
      ),
      findFirst: vi.fn((_args: { where: Record<string, unknown> }) =>
        Promise.resolve({ id: id(0) } as unknown),
      ),
    },
  };
  const explorer = {
    whereOf: vi.fn((_user: RequestUser, _filters: EventFilters) =>
      Promise.resolve(VISIBLE as Prisma.AuditEventWhereInput | undefined),
    ),
    // No subject blocked after an erasure, unless a spec says so (explorer/blocked.ts).
    blockedBy: vi.fn((_user: RequestUser, _filters: EventFilters) =>
      Promise.resolve({ apps: [] as string[], where: [] as Prisma.AuditEventWhereInput[] }),
    ),
  };
  const hubAudit = { recordQuietly: vi.fn((_input: HubEventInput) => Promise.resolve()) };
  const service = new ExportService(
    prisma as unknown as PrismaService,
    explorer as unknown as ExplorerService,
    hubAudit as unknown as HubAuditService,
  );
  return { prisma, explorer, hubAudit, service };
}

const sha256 = (text: string) => createHash('sha256').update(text).digest();

describe('csvCell', () => {
  it('writes nothing for no value, ISO 8601 for a date, the text of anything else', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(STARTED)).toBe('2026-10-15T12:34:56.789Z');
    expect(csvCell(201)).toBe('201');
    expect(csvCell(false)).toBe('false');
    expect(csvCell('auth.session.signed_in')).toBe('auth.session.signed_in');
  });

  it('defuses what a spreadsheet would run as a formula (OWASP CSV injection)', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-1)).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // A leading carriage return is also a line break: prefixed, then quoted.
    expect(csvCell('\rcmd')).toBe('"\'\rcmd"');
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('quotes a cell with a comma, a quote or a line break, doubling its quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });
});

describe('ExportService', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  describe('stream', () => {
    it('streams CSV, a header then a row per event, with its digest kept, sent and recorded', async () => {
      const { prisma, explorer, hubAudit, service } = setup();
      prisma.auditEvent.findMany.mockResolvedValueOnce([
        exportRow(1),
        exportRow(2, {
          actorId: '=cmd()',
          resourceType: 'document',
          resourceId: 'a,b',
          httpStatus: null,
          geoCountry: 'ES',
        }),
      ]);
      const { res, body } = fakeResponse();
      const filters: EventFilters = { appId: APP, outcome: 'success', actorId: undefined };
      await service.stream(AUDITOR, filters, 'csv', REQ, res as unknown as Response);

      expect(explorer.whereOf).toHaveBeenCalledWith(AUDITOR, filters);
      expect(explorer.blockedBy).toHaveBeenCalledWith(AUDITOR, filters);
      expect(prisma.exportJob.create).toHaveBeenCalledWith({
        data: {
          requestedById: AUDITOR.id,
          filters,
          format: 'csv',
          rowCap: EXPORT_ROW_CAP,
          status: 'running',
        },
        select: { id: true, startedAt: true },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(Object.fromEntries(res.setHeader.mock.calls)).toEqual({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audit-events-2026-10-15T12-34-56.csv"',
        'Cache-Control': 'no-store',
        'Audit-Export-Id': JOB,
        Trailer: 'Content-Digest',
      });
      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: { AND: [SCOPED, {}] },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 1000,
        select: expect.objectContaining({
          details: true,
          app: { select: { slug: true } },
        }) as unknown,
      });

      const text = body();
      expect(text.split('\r\n')).toEqual([
        HEADER,
        [
          minus(1).toISOString(),
          minus(2).toISOString(),
          'my-project',
          'security',
          'auth.session.signed_in',
          'success',
          'info',
          '0',
          'user',
          'user-1',
          'member',
          '',
          '',
          'req-1',
          'POST',
          '/api/sessions',
          '201',
          'web',
          '',
          'public',
          id(1001),
          id(1),
        ].join(','),
        [
          minus(2).toISOString(),
          minus(3).toISOString(),
          'my-project',
          'security',
          'auth.session.signed_in',
          'success',
          'info',
          '0',
          'user',
          "'=cmd()",
          'member',
          'document',
          '"a,b"',
          'req-1',
          'POST',
          '/api/sessions',
          '',
          'web',
          'ES',
          'public',
          id(1002),
          id(2),
        ].join(','),
        '',
      ]);

      const digest = sha256(text);
      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: JOB },
        data: {
          status: 'completed',
          rowCount: 2,
          digest: digest.toString('base64'),
          finishedAt: expect.any(Date) as Date,
        },
      });
      expect(hubAudit.recordQuietly).toHaveBeenCalledWith({
        action: 'hub.export.created',
        actor: { type: 'user', id: AUDITOR.id, role: 'auditor' },
        resource: { type: 'export', id: JOB },
        details: {
          appId: APP,
          format: 'csv',
          rows: 2,
          digest: digest.toString('hex'),
          filters: ['appId', 'outcome'],
        },
        request: REQ,
      });
      expect(res.addTrailers).toHaveBeenCalledWith({
        'Content-Digest': `sha-256=:${digest.toString('base64')}:`,
      });
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(res.destroy).not.toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        `Export ${JOB} by ${AUDITOR.id}: 2 rows (csv)`,
      );
    });

    it('streams JSON Lines with the details, and exports nothing the caller may not see', async () => {
      const { prisma, explorer, hubAudit, service } = setup();
      explorer.whereOf.mockResolvedValueOnce(undefined);
      prisma.auditEvent.findMany.mockResolvedValueOnce([exportRow(1)]);
      const { res, body } = fakeResponse();
      await service.stream(AUDITOR, {}, 'jsonl', REQ, res as unknown as Response);

      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [{ id: { in: [] } }, {}],
      });
      // Nothing visible: no blocked subject looked up either.
      expect(explorer.blockedBy).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/x-ndjson; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="audit-events-2026-10-15T12-34-56.jsonl"',
      );
      const lines = body().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe('');
      expect(JSON.parse(lines[0]!)).toEqual({
        recordedAt: minus(1).toISOString(),
        occurredAt: minus(2).toISOString(),
        app: 'my-project',
        category: 'security',
        action: 'auth.session.signed_in',
        outcome: 'success',
        severity: 'info',
        riskScore: 0,
        actorType: 'user',
        actorId: 'user-1',
        actorRole: 'member',
        resourceType: null,
        resourceId: null,
        requestId: 'req-1',
        httpMethod: 'POST',
        httpRoute: '/api/sessions',
        httpStatus: 201,
        clientType: 'web',
        country: null,
        ipScope: 'public',
        eventId: id(1001),
        id: id(1),
        details: { method: 'password' },
      });
      const details = hubAudit.recordQuietly.mock.calls[0]![0].details;
      expect(details).not.toHaveProperty('appId');
      expect(details).toMatchObject({ format: 'jsonl', rows: 1, filters: [] });
    });

    it('leaves out the applications where the subject exported by id is blocked, as the search does', async () => {
      const { prisma, explorer, service } = setup();
      explorer.blockedBy.mockResolvedValueOnce({
        apps: [OTHER],
        where: [{ appId: { notIn: [OTHER] } }],
      });
      const { res } = fakeResponse();
      const filters: EventFilters = { actorId: 'user-7' };
      await service.stream(AUDITOR, filters, 'csv', REQ, res as unknown as Response);
      expect(explorer.blockedBy).toHaveBeenCalledWith(AUDITOR, filters);
      expect(prisma.auditEvent.findMany.mock.calls[0]![0].where).toEqual({
        AND: [{ AND: [VISIBLE, { appId: { notIn: [OTHER] } }] }, {}],
      });
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('keeps an email or an IP filter only as "given", never the value', async () => {
      const { prisma, hubAudit, service } = setup();
      const { res } = fakeResponse();
      const filters: EventFilters = { appId: APP, email: 'ada@example.com', ip: '198.51.100.20' };
      await service.stream(AUDITOR, filters, 'csv', REQ, res as unknown as Response);
      expect(prisma.exportJob.create.mock.calls[0]![0].data.filters).toEqual({
        appId: APP,
        email: '(given)',
        ip: '(given)',
      });
      const recorded = JSON.stringify(hubAudit.recordQuietly.mock.calls[0]![0]);
      expect(recorded).not.toContain('ada@example.com');
      expect(recorded).not.toContain('198.51.100.20');
      expect(hubAudit.recordQuietly.mock.calls[0]![0].details?.filters).toEqual([
        'appId',
        'email',
        'ip',
      ]);
    });

    it('reads in batches, each after the last row of the one before, until one comes back short', async () => {
      const { prisma, service } = setup();
      const full = Array.from({ length: 1000 }, (_, n) => exportRow(n + 1));
      prisma.auditEvent.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([]);
      const { res, body } = fakeResponse();
      await service.stream(AUDITOR, { appId: APP }, 'jsonl', REQ, res as unknown as Response);

      expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.auditEvent.findMany.mock.calls[1]![0].where).toEqual({
        AND: [
          SCOPED,
          {
            OR: [
              { recordedAt: { lt: minus(1000) } },
              { recordedAt: minus(1000), id: { lt: id(1000) } },
            ],
          },
        ],
      });
      expect(body().split('\n')).toHaveLength(1001);
      expect(prisma.exportJob.update.mock.calls[0]![0].data).toMatchObject({
        status: 'completed',
        rowCount: 1000,
      });
    });

    it('stops at the row cap and says the export was truncated when more rows remain', async () => {
      const { prisma, service } = setup();
      const row = exportRow(1, { details: null, actorRole: null, requestId: null });
      prisma.auditEvent.findMany.mockImplementation((args) =>
        Promise.resolve(Array.from({ length: args.take }, () => row)),
      );
      const { res } = fakeResponse();
      // Only counted: the body itself is not needed here.
      res.write.mockImplementation(() => true);
      await service.stream(AUDITOR, { appId: APP }, 'jsonl', REQ, res as unknown as Response);

      expect(prisma.auditEvent.findMany).toHaveBeenCalledTimes(EXPORT_ROW_CAP / 1000);
      expect(res.write).toHaveBeenCalledTimes(EXPORT_ROW_CAP);
      expect(prisma.auditEvent.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            SCOPED,
            {
              OR: [
                { recordedAt: { lt: row.recordedAt } },
                { recordedAt: row.recordedAt, id: { lt: row.id } },
              ],
            },
          ],
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      expect(prisma.exportJob.update.mock.calls[0]![0].data).toMatchObject({
        status: 'truncated',
        rowCount: EXPORT_ROW_CAP,
      });
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('waits for a slow client to drain before writing on', async () => {
      const { prisma, service } = setup();
      const { res, chunks } = fakeResponse();
      const order: string[] = [];
      res.on('drain', () => order.push('drain'));
      res.write.mockImplementation((chunk: string) => {
        chunks.push(chunk);
        order.push('write');
        if (order.length > 1) return true;
        setImmediate(() => res.emit('drain'));
        return false;
      });
      await service.stream(AUDITOR, { appId: APP }, 'jsonl', REQ, res as unknown as Response);

      expect(order).toEqual(['write', 'drain', 'write']);
      expect(res.listenerCount('drain')).toBe(1);
      expect(prisma.exportJob.update.mock.calls[0]![0].data).toMatchObject({ rowCount: 2 });
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('stops and marks the export failed when the client leaves while it waits', async () => {
      const { prisma, hubAudit, service } = setup();
      const { res } = fakeResponse();
      res.write.mockImplementation(() => {
        // The client closes the connection: 'drain' never comes.
        setImmediate(() => res.emit('close'));
        return false;
      });
      await service.stream(AUDITOR, { appId: APP }, 'jsonl', REQ, res as unknown as Response);

      // The header row is not written for JSON Lines: one row, then nothing more.
      expect(res.write).toHaveBeenCalledTimes(1);
      expect(res.listenerCount('drain')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
      expect(prisma.exportJob.update.mock.calls[0]![0].data).toMatchObject({
        status: 'failed',
        rowCount: 0,
      });
      expect(Logger.prototype.warn).toHaveBeenCalledWith(`Export ${JOB}: the client left`);
      expect(res.end).not.toHaveBeenCalled();
      expect(hubAudit.recordQuietly).not.toHaveBeenCalled();
    });

    it('marks the export failed and breaks the response when reading fails', async () => {
      const { prisma, hubAudit, service } = setup();
      const failure = new Error('connection lost');
      prisma.auditEvent.findMany
        .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, n) => exportRow(n + 1)))
        .mockRejectedValueOnce(failure);
      const { res } = fakeResponse();
      await service.stream(AUDITOR, { appId: APP }, 'csv', REQ, res as unknown as Response);

      expect(Logger.prototype.error).toHaveBeenCalledWith(`Export ${JOB} failed: connection lost`);
      expect(prisma.exportJob.update).toHaveBeenCalledTimes(1);
      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: JOB },
        data: { status: 'failed', rowCount: 1000, finishedAt: expect.any(Date) as Date },
      });
      expect(res.destroy).toHaveBeenCalledWith(failure);
      expect(res.end).not.toHaveBeenCalled();
      expect(res.addTrailers).not.toHaveBeenCalled();
      expect(hubAudit.recordQuietly).not.toHaveBeenCalled();
    });

    it('breaks the response with an Error even when something else was thrown', async () => {
      const { prisma, service } = setup();
      prisma.auditEvent.findMany.mockRejectedValueOnce('boom');
      const { res } = fakeResponse();
      await service.stream(AUDITOR, { appId: APP }, 'csv', REQ, res as unknown as Response);

      expect(Logger.prototype.error).toHaveBeenCalledWith(`Export ${JOB} failed: boom`);
      expect(prisma.exportJob.update.mock.calls[0]![0].data).toMatchObject({
        status: 'failed',
        rowCount: 0,
      });
      const [error] = res.destroy.mock.calls[0]!;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('boom');
    });

    it('only logs a failure to mark the export finished: the body is whole, so it still ends', async () => {
      const { prisma, hubAudit, service } = setup();
      prisma.exportJob.update.mockRejectedValueOnce(new Error('database restarting'));
      const { res } = fakeResponse();
      await service.stream(AUDITOR, { appId: APP }, 'csv', REQ, res as unknown as Response);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        `Export ${JOB} not marked finished: database restarting`,
      );
      expect(hubAudit.recordQuietly).toHaveBeenCalledTimes(1);
      expect(res.addTrailers).toHaveBeenCalledTimes(1);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(res.destroy).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it("lists the caller's own exports, newest first, a page at a time", async () => {
      const { prisma, service } = setup();
      await expect(service.list(AUDITOR, { limit: 20, offset: 40 })).resolves.toEqual({
        items: [
          expect.objectContaining({ id: JOB, requestedById: AUDITOR.id, filters: { appId: APP } }),
        ],
        total: 1,
      });
      expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
        where: { requestedById: AUDITOR.id },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 20,
        skip: 40,
      });
      expect(prisma.exportJob.count).toHaveBeenCalledWith({ where: { requestedById: AUDITOR.id } });
    });

    it("lists everyone's for an administrator", async () => {
      const { prisma, service } = setup();
      await service.list(ADMIN, { limit: 20, offset: 0 });
      expect(prisma.exportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.exportJob.count).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('get', () => {
    it("answers an export's outcome to whoever asked for it", async () => {
      const { prisma, service } = setup();
      await expect(service.get(AUDITOR, JOB)).resolves.toEqual({
        id: JOB,
        requestedById: AUDITOR.id,
        format: 'csv',
        filters: { appId: APP },
        status: 'completed',
        rowCap: EXPORT_ROW_CAP,
        rowCount: 2,
        digest: 'c2hhLTI1Ng==',
        startedAt: STARTED.toISOString(),
        finishedAt: new Date(STARTED.getTime() + 1500).toISOString(),
      });
      expect(prisma.exportJob.findUnique).toHaveBeenCalledWith({ where: { id: JOB } });
    });

    it('answers a running export without a finish time', async () => {
      const { prisma, service } = setup();
      prisma.exportJob.findUnique.mockResolvedValueOnce(
        jobRow({ status: 'running', rowCount: null, digest: null, finishedAt: null }),
      );
      await expect(service.get(AUDITOR, JOB)).resolves.toMatchObject({
        status: 'running',
        rowCount: null,
        digest: null,
        finishedAt: null,
      });
    });

    it("answers 404 for an unknown export, and for someone else's unless an administrator asks", async () => {
      const { prisma, service } = setup();
      prisma.exportJob.findUnique.mockResolvedValueOnce(null);
      await expect(service.get(AUDITOR, JOB)).rejects.toThrow(NotFoundException);

      const theirs = jobRow({ requestedById: '0199e0b1-0000-7000-8000-00000000000c' });
      prisma.exportJob.findUnique.mockResolvedValueOnce(theirs);
      await expect(service.get(AUDITOR, JOB)).rejects.toThrow('Export not found');
      prisma.exportJob.findUnique.mockResolvedValueOnce(theirs);
      await expect(service.get(ADMIN, JOB)).resolves.toMatchObject({ id: JOB });
    });
  });
});
