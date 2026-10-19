import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  contentHashOf,
  type EventRow,
  locationDigestOf,
  personalDigestOf,
} from '../ingest/event-rows.js';
import { recordIntegrityCheck } from '../observability/metrics.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INTEGRITY_KEYRING } from './integrity.constants.js';
import type { IntegrityKeyring } from './integrity-keys.js';
import { bytesEqual, decodeLeaves, GENESIS_HASH, hmac, sealHash, sha256 } from './seal-math.js';

export type FailureKind =
  | 'seal_missing'
  | 'seal_modified'
  | 'chain_broken'
  | 'window_gap'
  | 'signature_invalid'
  | 'signature_unverifiable'
  | 'leaves_modified'
  | 'event_modified'
  | 'event_inserted'
  | 'event_deleted'
  | 'personal_modified'
  | 'location_modified';

export interface IntegrityFailure {
  kind: FailureKind;
  appId: string;
  category: string;
  sealNo?: string;
  /** Audit Hub's id of the event, when the failure is about one. */
  eventPk?: string;
}

export interface VerificationReport {
  outcome: 'passed' | 'failed';
  eventsChecked: number;
  sealsChecked: number;
  failures: IntegrityFailure[];
}

export interface VerifyOptions {
  appId?: string;
  /** Only seals whose window ends after this (the chain before it is taken as verified). */
  since?: Date;
  trigger: 'job' | 'cli';
}

const SEALS_PER_PAGE = 500;
const MAX_FAILURES = 1000;

const EVENT_SELECT = {
  id: true,
  appId: true,
  eventId: true,
  sequenceEpoch: true,
  sourceSeq: true,
  catalogVersionId: true,
  schemaVersion: true,
  connectorName: true,
  connectorVersion: true,
  occurredAt: true,
  recordedAt: true,
  category: true,
  action: true,
  outcome: true,
  severity: true,
  riskScore: true,
  reason: true,
  actorType: true,
  actorId: true,
  actorRole: true,
  actorEmailHmac: true,
  actorEmailHmacShared: true,
  impersonatorId: true,
  sessionRef: true,
  resourceType: true,
  resourceId: true,
  parentResourceType: true,
  parentResourceId: true,
  changeBefore: true,
  changeAfter: true,
  changedFields: true,
  requestId: true,
  traceId: true,
  httpMethod: true,
  httpRoute: true,
  httpStatus: true,
  durationMs: true,
  clientType: true,
  clientAppVersion: true,
  clientAppBuild: true,
  clientUpdateId: true,
  clientOs: true,
  clientOsVersion: true,
  clientDeviceModel: true,
  clientLocale: true,
  clientTimeZone: true,
  clientNetworkType: true,
  clientRoute: true,
  clientSdk: true,
  clientDeclared: true,
  ipScope: true,
  geoCountry: true,
  geoAsn: true,
  uaBrowser: true,
  uaOs: true,
  uaDeviceClass: true,
  details: true,
  truncatedFields: true,
  droppedFields: true,
  flags: true,
  personalDigest: true,
  locationDigest: true,
  contentHash: true,
  personal: true,
  location: true,
} satisfies Prisma.AuditEventSelect;

type StoredEvent = Prisma.AuditEventGetPayload<{ select: typeof EVENT_SELECT }>;

// Recomputes what the seals promise (docs/adr/0008): the chain of seal
// hashes and their signatures, the leaves of each window against the events
// stored in it, every event's content hash from its columns, and the
// satellite rows' digests. A missing event is accounted for only by the
// retention runs that deleted events of its seal.
@Injectable()
export class VerifierService {
  private readonly logger = new Logger('Integrity');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRITY_KEYRING) private readonly keys: IntegrityKeyring,
  ) {}

  async verify(options: VerifyOptions): Promise<VerificationReport & { id: string }> {
    const startedAt = new Date();
    const report: VerificationReport = {
      outcome: 'passed',
      eventsChecked: 0,
      sealsChecked: 0,
      failures: [],
    };
    const streams = await this.prisma.integritySeal.groupBy({
      by: ['appId', 'category'],
      ...(options.appId === undefined ? {} : { where: { appId: options.appId } }),
    });
    for (const stream of streams) {
      await this.verifyStream(stream.appId, stream.category, options.since, report);
    }
    report.outcome = report.failures.length === 0 ? 'passed' : 'failed';
    const saved = await this.prisma.integrityVerification.create({
      data: {
        trigger: options.trigger,
        scope: {
          ...(options.appId === undefined ? {} : { appId: options.appId }),
          ...(options.since === undefined ? {} : { since: options.since.toISOString() }),
        },
        outcome: report.outcome,
        eventsChecked: BigInt(report.eventsChecked),
        sealsChecked: report.sealsChecked,
        failures: report.failures.length,
        // Ids only, as plain JSON.
        failureSample:
          report.failures.length === 0
            ? undefined
            : report.failures
                .slice(0, 20)
                .map(
                  (failure) =>
                    Object.fromEntries(
                      Object.entries(failure).filter(([, value]) => value !== undefined),
                    ) as Record<string, string>,
                ),
        startedAt,
      },
      select: { id: true },
    });
    recordIntegrityCheck(report.outcome);
    if (report.outcome === 'failed') {
      this.logger.error(
        `Integrity verification ${saved.id} FAILED: ${String(report.failures.length)} failure(s), the first ${report.failures[0]?.kind ?? '?'} in ${report.failures[0]?.appId ?? '?'}/${report.failures[0]?.category ?? '?'} seal ${report.failures[0]?.sealNo ?? '?'}${report.failures[0]?.eventPk === undefined ? '' : ` event ${report.failures[0].eventPk}`}`,
      );
    } else {
      this.logger.log(
        `Integrity verification ${saved.id} passed: ${String(report.sealsChecked)} seals, ${String(report.eventsChecked)} events`,
      );
    }
    return { id: saved.id, ...report };
  }

  private async verifyStream(
    appId: string,
    category: StoredEvent['category'],
    since: Date | undefined,
    report: VerificationReport,
  ): Promise<void> {
    const fail = (failure: Omit<IntegrityFailure, 'appId' | 'category'>) => {
      if (report.failures.length < MAX_FAILURES)
        report.failures.push({ appId, category, ...failure });
    };
    // Where to start: the first seal, or the last one before `since`, whose
    // hash seeds the chain (it was verified by an earlier run).
    const before =
      since === undefined
        ? null
        : await this.prisma.integritySeal.findFirst({
            where: { appId, category, windowTo: { lte: since } },
            orderBy: { sealNo: 'desc' },
            select: { sealNo: true, sealHash: true, windowTo: true },
          });
    let prevHash: Uint8Array = before?.sealHash ?? GENESIS_HASH;
    let expectedNo = (before?.sealNo ?? 0n) + 1n;
    let previousWindowTo: Date | undefined = before?.windowTo;
    let unverifiedSignature: bigint | undefined;

    for (;;) {
      const seals = await this.prisma.integritySeal.findMany({
        where: { appId, category, sealNo: { gte: expectedNo } },
        orderBy: { sealNo: 'asc' },
        take: SEALS_PER_PAGE,
        include: { leaves: true, retentionRuns: { select: { deletedCount: true } } },
      });
      if (seals.length === 0) break;
      for (const seal of seals) {
        report.sealsChecked += 1;
        const sealNo = seal.sealNo.toString();
        if (seal.sealNo !== expectedNo)
          fail({ kind: 'seal_missing', sealNo: expectedNo.toString() });
        if (!bytesEqual(seal.prevHash, prevHash)) fail({ kind: 'chain_broken', sealNo });
        if (
          previousWindowTo !== undefined &&
          seal.windowFrom.getTime() !== previousWindowTo.getTime()
        ) {
          fail({ kind: 'window_gap', sealNo });
        }
        const recomputed = sealHash({
          appId,
          category,
          sealNo: seal.sealNo,
          windowFrom: seal.windowFrom,
          windowTo: seal.windowTo,
          eventCount: seal.eventCount,
          leavesDigest: seal.leavesDigest,
          prevHash: seal.prevHash,
        });
        if (!bytesEqual(recomputed, seal.sealHash)) fail({ kind: 'seal_modified', sealNo });
        const key = this.keys.all.find((candidate) => candidate.id === seal.keyId);
        if (key === undefined) {
          // Signed with a key no longer configured: accepted once a later
          // seal, chained to it, verifies with a current key.
          unverifiedSignature ??= seal.sealNo;
        } else if (!bytesEqual(hmac(key.key, seal.sealHash), seal.signature)) {
          fail({ kind: 'signature_invalid', sealNo });
        } else {
          unverifiedSignature = undefined;
        }
        await this.verifyWindow(appId, category, seal, report, fail);
        prevHash = seal.sealHash;
        previousWindowTo = seal.windowTo;
        expectedNo = seal.sealNo + 1n;
      }
    }
    if (unverifiedSignature !== undefined) {
      fail({ kind: 'signature_unverifiable', sealNo: unverifiedSignature.toString() });
    }
    // Nothing may sit before the first window of the stream.
    const first = await this.prisma.integritySeal.findFirst({
      where: { appId, category },
      orderBy: { sealNo: 'asc' },
      select: { windowFrom: true },
    });
    if (first !== null) {
      const early = await this.prisma.auditEvent.findMany({
        where: { appId, category, recordedAt: { lt: first.windowFrom } },
        select: { id: true },
        take: 10,
      });
      for (const event of early) fail({ kind: 'event_inserted', eventPk: event.id });
    }
  }

  private async verifyWindow(
    appId: string,
    category: StoredEvent['category'],
    seal: {
      sealNo: bigint;
      windowFrom: Date;
      windowTo: Date;
      eventCount: number;
      leavesDigest: Uint8Array;
      leaves: { leaves: Uint8Array } | null;
      retentionRuns: { deletedCount: number }[];
    },
    report: VerificationReport,
    fail: (failure: Omit<IntegrityFailure, 'appId' | 'category'>) => void,
  ): Promise<void> {
    const sealNo = seal.sealNo.toString();
    const events = await this.prisma.auditEvent.findMany({
      where: { appId, category, recordedAt: { gte: seal.windowFrom, lt: seal.windowTo } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      select: EVENT_SELECT,
    });
    report.eventsChecked += events.length;
    const deleted = seal.retentionRuns.reduce((total, run) => total + run.deletedCount, 0);
    if (seal.leaves === null) {
      // Every event of the window was purged: none may be there, and the
      // retention runs account for all of them.
      for (const event of events) fail({ kind: 'event_inserted', sealNo, eventPk: event.id });
      if (deleted !== seal.eventCount) fail({ kind: 'event_deleted', sealNo });
      return;
    }
    if (!bytesEqual(sha256(seal.leaves.leaves), seal.leavesDigest)) {
      fail({ kind: 'leaves_modified', sealNo });
      return;
    }
    const leaves = decodeLeaves(seal.leaves.leaves);
    if (leaves.length !== seal.eventCount) {
      fail({ kind: 'leaves_modified', sealNo });
      return;
    }
    const expected = new Map(leaves.map((leaf) => [leaf.eventPk, leaf.contentHash]));
    for (const event of events) {
      const leaf = expected.get(event.id);
      if (leaf === undefined) {
        fail({ kind: 'event_inserted', sealNo, eventPk: event.id });
        continue;
      }
      expected.delete(event.id);
      const row = event as unknown as EventRow;
      if (
        !bytesEqual(contentHashOf(row), event.contentHash) ||
        !bytesEqual(event.contentHash, leaf)
      ) {
        fail({ kind: 'event_modified', sealNo, eventPk: event.id });
      }
      if (event.personal !== null && event.personalDigest !== null) {
        if (!bytesEqual(personalDigestOf(personalRowOf(event.personal)), event.personalDigest)) {
          fail({ kind: 'personal_modified', sealNo, eventPk: event.id });
        }
      }
      if (event.location !== null && event.locationDigest !== null) {
        if (!bytesEqual(locationDigestOf(locationRowOf(event.location)), event.locationDigest)) {
          fail({ kind: 'location_modified', sealNo, eventPk: event.id });
        }
      }
    }
    // Leaves without their event: only the retention runs may explain them.
    if (expected.size !== deleted) {
      if (deleted === 0) {
        for (const eventPk of expected.keys()) fail({ kind: 'event_deleted', sealNo, eventPk });
      } else {
        fail({ kind: 'event_deleted', sealNo });
      }
    }
  }
}

function personalRowOf(row: NonNullable<StoredEvent['personal']>) {
  return {
    ...row,
    geoLatitude: row.geoLatitude === null ? null : row.geoLatitude.toFixed(3),
    geoLongitude: row.geoLongitude === null ? null : row.geoLongitude.toFixed(3),
    personalChange: row.personalChange as never,
    clientHints: row.clientHints as never,
  };
}

// Each row at the decimals it was written with: two for the approximate
// positions (every row before precise ones existed), five for precise ones.
function locationRowOf(row: NonNullable<StoredEvent['location']>) {
  return {
    ...row,
    latitude: row.latitude.toFixed(row.coordinateDecimals),
    longitude: row.longitude.toFixed(row.coordinateDecimals),
  };
}
