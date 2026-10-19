import { Injectable, Logger } from '@nestjs/common';
import {
  type EventBatchResult,
  type EventResult,
  normalizeAuditEvent,
  type RejectionReason,
  RETRYABLE_REJECTIONS,
} from 'audit-contract';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { recordIngestBatch, recordIngestEvents } from '../observability/metrics.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService, type ResolvedCatalog } from './catalog.service.js';
import { buildRows, type EventRow, type LocationRow, type PersonalRow } from './event-rows.js';
import type { AuthenticatedApp } from './ingest.types.js';

export interface IncomingBatch {
  connector: { name: string; version: string };
  sequenceEpoch: string;
  events: unknown[];
}

interface Built {
  index: number;
  event: EventRow;
  personal: PersonalRow | null;
  location: LocationRow | null;
  truncatedFields: string[];
  droppedFields: string[];
}

interface ExceptionRow {
  appId: string;
  epoch: string;
  sourceSeq: bigint | null;
  eventId: string | null;
  kind: 'rejected' | 'duplicate';
  reason: string;
  errorPaths: string[];
  payloadBytes: number;
  connectorVersion: string;
}

const json = (value: unknown) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

// POST /api/ingest/events (docs/design/audit-hub/contract.md). Every event is
// judged on its own; the batch never fails because of one of them. Accepted
// events, their satellite rows, the bookkeeping of the rest and the sequence
// state are written in one short transaction: recorded_at is the
// transaction's start, and transaction_timeout bounds how late it can commit
// (docs/adr/0008).
@Injectable()
export class EventIngestService {
  private readonly logger = new Logger('Ingest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: CatalogService,
    private readonly enrichment: EnrichmentService,
  ) {}

  async ingest(
    app: AuthenticatedApp,
    batch: IncomingBatch,
    now: number = Date.now(),
  ): Promise<EventBatchResult> {
    const results: EventResult[] = [];
    const exceptions: ExceptionRow[] = [];
    const candidates: {
      index: number;
      normalized: Extract<ReturnType<typeof normalizeAuditEvent>, { status: 'ok' }>;
    }[] = [];
    // Sizes of the events as they arrived (the bookkeeping of refused ones).
    const sizes = batch.events.map((raw) => Buffer.byteLength(JSON.stringify(raw)));
    const exception = (
      kind: ExceptionRow['kind'],
      reason: string,
      sourceSeq: number | undefined,
      eventId: string | undefined,
      paths: string[],
      index: number,
    ): ExceptionRow => ({
      appId: app.appId,
      epoch: batch.sequenceEpoch,
      sourceSeq: sourceSeq === undefined ? null : BigInt(sourceSeq),
      eventId: eventId ?? null,
      kind,
      reason,
      errorPaths: paths.slice(0, 10),
      payloadBytes: sizes[index] ?? 0,
      connectorVersion: batch.connector.version,
    });
    const reject = (
      index: number,
      reason: RejectionReason,
      ids: { eventId?: string; sourceSeq?: number },
      paths: string[],
    ) => {
      const retryable = RETRYABLE_REJECTIONS.includes(reason);
      results[index] = { index, ...ids, status: 'rejected', reason, retryable };
      // A retryable event comes back: its number is not consumed yet.
      if (!retryable)
        exceptions.push(exception('rejected', reason, ids.sourceSeq, ids.eventId, paths, index));
    };

    batch.events.forEach((raw, index) => {
      const normalized = normalizeAuditEvent(raw, now);
      if (normalized.status === 'rejected') {
        reject(
          index,
          normalized.reason,
          {
            ...(normalized.eventId === undefined ? {} : { eventId: normalized.eventId }),
            ...(normalized.sourceSeq === undefined ? {} : { sourceSeq: normalized.sourceSeq }),
          },
          normalized.paths,
        );
      } else {
        candidates.push({ index, normalized });
      }
    });

    const catalogs = new Map<string, ResolvedCatalog | undefined>();
    for (const { normalized } of candidates) {
      const version = normalized.event.catalogVersion;
      if (!catalogs.has(version))
        catalogs.set(version, await this.catalogs.resolve(app.appId, version));
    }

    let maxSeq = 0n;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL transaction_timeout = '10s'`;
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT date_trunc('milliseconds', now()) AS "now"`;
        const recordedAt = clock?.now ?? new Date(now);

        const built: Built[] = [];
        const inBatch = new Set<string>();
        for (const { index, normalized } of candidates) {
          const { event } = normalized;
          const ids = { eventId: event.eventId, sourceSeq: event.sourceSeq };
          // The same event twice in one batch: the second is a duplicate of the first.
          if (inBatch.has(event.eventId)) {
            results[index] = { index, ...ids, status: 'duplicate' };
            continue;
          }
          inBatch.add(event.eventId);
          const catalog = catalogs.get(event.catalogVersion);
          if (catalog === undefined) {
            reject(index, 'catalog_version_unknown', ids, ['catalogVersion']);
            continue;
          }
          const spec = catalog.actions.get(event.action);
          if (spec === undefined) {
            reject(index, 'action_unknown', ids, ['action']);
            continue;
          }
          const rows = buildRows({
            event,
            spec,
            envelope: {
              appId: app.appId,
              sequenceEpoch: batch.sequenceEpoch,
              connectorName: batch.connector.name,
              connectorVersion: batch.connector.version,
              catalogVersionId: catalog.id,
            },
            recordedAt,
            truncatedFields: normalized.truncatedFields,
            droppedFields: normalized.droppedFields,
            flags: normalized.flags,
            enrichment: this.enrichment.enrich(event),
          });
          if (rows.status === 'rejected') {
            reject(index, rows.reason, ids, rows.paths);
            continue;
          }
          built.push({ index, ...rows });
        }

        const inserted =
          built.length === 0
            ? []
            : await tx.auditEvent.createManyAndReturn({
                data: built.map(({ event }) => ({
                  ...event,
                  changeBefore: json(event.changeBefore),
                  changeAfter: json(event.changeAfter),
                  details: json(event.details),
                })),
                skipDuplicates: true,
                select: { eventId: true },
              });
        const insertedIds = new Set(inserted.map((row) => row.eventId));
        const stored = built.filter(({ event }) => insertedIds.has(event.eventId));
        const personal = stored.flatMap(({ personal: row }) => (row === null ? [] : [row]));
        if (personal.length > 0) {
          await tx.eventPersonal.createMany({
            data: personal.map((row) => ({
              ...row,
              personalChange: json(row.personalChange),
              clientHints: json(row.clientHints),
            })),
          });
        }
        const locations = stored.flatMap(({ location }) => (location === null ? [] : [location]));
        if (locations.length > 0) await tx.eventLocation.createMany({ data: locations });

        for (const item of stored) {
          results[item.index] = {
            index: item.index,
            eventId: item.event.eventId,
            sourceSeq: Number(item.event.sourceSeq),
            status: 'accepted',
            ...(item.truncatedFields.length > 0 ? { truncatedFields: item.truncatedFields } : {}),
            ...(item.droppedFields.length > 0 ? { droppedFields: item.droppedFields } : {}),
          };
        }

        // Not inserted: the same event again (a retry), or its sequence
        // number already taken by another event (a conflict).
        const skipped = built.filter(({ event }) => !insertedIds.has(event.eventId));
        if (skipped.length > 0) {
          const existing = await tx.auditEvent.findMany({
            where: { appId: app.appId, eventId: { in: skipped.map(({ event }) => event.eventId) } },
            select: { eventId: true, sequenceEpoch: true, sourceSeq: true },
          });
          const byEventId = new Map(existing.map((row) => [row.eventId, row]));
          for (const { index, event } of skipped) {
            const ids = { eventId: event.eventId, sourceSeq: Number(event.sourceSeq) };
            const stored = byEventId.get(event.eventId);
            if (stored === undefined) {
              this.logger.warn(
                `Sequence conflict from ${app.slug}: ${String(event.sourceSeq)} of epoch ${batch.sequenceEpoch} is another event's`,
              );
              reject(index, 'sequence_conflict', ids, ['sourceSeq']);
              continue;
            }
            results[index] = { index, ...ids, status: 'duplicate' };
            if (
              stored.sequenceEpoch !== batch.sequenceEpoch ||
              stored.sourceSeq !== event.sourceSeq
            ) {
              // Sent again with a new number (a device re-sent it): that
              // number is accounted for, so it is not a gap.
              exceptions.push(
                exception('duplicate', 'duplicate', ids.sourceSeq, ids.eventId, [], index),
              );
            }
          }
        }

        if (exceptions.length > 0) await tx.ingestException.createMany({ data: exceptions });

        for (const result of results) {
          if (result.sourceSeq === undefined) continue;
          if (result.status === 'rejected' && result.retryable === true) continue;
          if (BigInt(result.sourceSeq) > maxSeq) maxSeq = BigInt(result.sourceSeq);
        }
        if (maxSeq > 0n) {
          // A new epoch is acknowledged at once when it is the application's
          // first; a later one (a restore, a reset) waits for an admin.
          await tx.$executeRaw`
            INSERT INTO "sequence_states" ("app_id", "epoch", "max_seen", "acknowledged_at", "updated_at")
            VALUES (${app.appId}::uuid, ${batch.sequenceEpoch}::uuid, ${maxSeq},
              CASE WHEN EXISTS (SELECT 1 FROM "sequence_states" WHERE "app_id" = ${app.appId}::uuid)
                THEN NULL ELSE now() END,
              now())
            ON CONFLICT ("app_id", "epoch") DO UPDATE
              SET "max_seen" = GREATEST("sequence_states"."max_seen", EXCLUDED."max_seen"), "updated_at" = now()`;
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );

    const count = (status: EventResult['status'], reason?: string) =>
      results.filter(
        (result) => result.status === status && (reason === undefined || result.reason === reason),
      ).length;
    recordIngestBatch(batch.events.length);
    recordIngestEvents(app.slug, 'accepted', 'none', count('accepted'));
    recordIngestEvents(app.slug, 'duplicate', 'none', count('duplicate'));
    for (const reason of new Set(
      results.flatMap((result) => (result.reason === undefined ? [] : [result.reason])),
    )) {
      recordIngestEvents(app.slug, 'rejected', reason, count('rejected', reason));
    }
    return {
      results,
      accepted: count('accepted'),
      duplicates: count('duplicate'),
      rejected: count('rejected'),
    };
  }
}
