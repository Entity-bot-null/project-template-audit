import { Logger } from '@nestjs/common';
import type { ActionSpec } from 'audit-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRows,
  type EventRow,
  type LocationRow,
  type PersonalRow,
} from '../ingest/event-rows.js';
import { Prisma } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { integrityKeyring } from './integrity-keys.js';
import { encodeLeaves, GENESIS_HASH, hmac, sealHash, sha256 } from './seal-math.js';
import { VerifierService } from './verifier.service.js';

const APP = '0199e0b1-0000-7000-8000-000000000001';
const T0 = Date.parse('2026-10-14T12:00:00.000Z');
const keys = integrityKeyring({
  key: 'k'.repeat(64),
  previous: undefined,
  fallback: 'f'.repeat(64),
});
const retired = integrityKeyring({
  key: 'r'.repeat(64),
  previous: undefined,
  fallback: 'f'.repeat(64),
});

const SIGNED_IN: ActionSpec = {
  category: 'security',
  severity: 'info',
  description: 'Signed in',
  source: 'server',
};

/** A location row as the database answers it: its coordinates DECIMAL(7,5) and (8,5). */
type StoredLocation = Omit<LocationRow, 'latitude' | 'longitude'> & {
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
};
type Stored = EventRow & { personal: PersonalRow | null; location: StoredLocation | null };

const asStored = (row: LocationRow): StoredLocation => ({
  ...row,
  // Padded to the column's five decimals, as PostgreSQL keeps them.
  latitude: new Prisma.Decimal(Number(row.latitude).toFixed(5)),
  longitude: new Prisma.Decimal(Number(row.longitude).toFixed(5)),
});

/** An event as ingestion builds it, at `T0 + offsetMs`, with a device location if given. */
function stored(
  n: number,
  offsetMs: number,
  location?: { latitude: number; longitude: number; accuracyM: number },
): Stored {
  const built = buildRows({
    event: {
      schemaVersion: 1,
      eventId: `0199e0b1-6a2c-7d9e-9f1a-${n.toString(16).padStart(12, '0')}`,
      sourceSeq: n,
      occurredAt: new Date(T0 + offsetMs - 1000).toISOString(),
      catalogVersion: '0123456789abcdef',
      category: 'security',
      action: 'auth.session.signed_in',
      outcome: 'success',
      actor: { type: 'user', id: `user-${String(n)}`, label: 'j***@e***.com' },
      ...(location === undefined
        ? {}
        : { location: { ...location, capturedAt: new Date(T0 + offsetMs - 2000).toISOString() } }),
    },
    spec: SIGNED_IN,
    envelope: {
      appId: APP,
      sequenceEpoch: '0199e0b1-0000-7000-8000-0000000000e1',
      connectorName: 'audit-nestjs',
      connectorVersion: '0.1.0',
      catalogVersionId: 'cat-1',
    },
    recordedAt: new Date(T0 + offsetMs),
    truncatedFields: [],
    droppedFields: [],
    flags: [],
  });
  if (built.status !== 'ok') throw new Error(built.reason);
  return {
    ...built.event,
    personal: built.personal,
    location: built.location === null ? null : asStored(built.location),
  };
}

interface FakeSeal {
  appId: string;
  category: 'security';
  sealNo: bigint;
  windowFrom: Date;
  windowTo: Date;
  eventCount: number;
  leavesDigest: Uint8Array;
  prevHash: Uint8Array;
  sealHash: Uint8Array;
  keyId: string;
  signature: Uint8Array;
  leaves: { leaves: Uint8Array } | null;
  retentionRuns: { deletedCount: number }[];
}

/** Seals `events` into consecutive windows of one minute from T0, signed with `key`. */
function chain(windows: Stored[][], key = keys.current): FakeSeal[] {
  let prevHash: Uint8Array = GENESIS_HASH;
  return windows.map((events, index) => {
    const leaves = encodeLeaves(
      events.map((event) => ({ eventPk: event.id, contentHash: event.contentHash })),
    );
    const fields = {
      appId: APP,
      category: 'security' as const,
      sealNo: BigInt(index + 1),
      windowFrom: new Date(T0 + index * 60_000),
      windowTo: new Date(T0 + (index + 1) * 60_000),
      eventCount: events.length,
      leavesDigest: sha256(leaves),
      prevHash,
    };
    const hash = sealHash(fields);
    prevHash = hash;
    return {
      ...fields,
      sealHash: hash,
      keyId: key.id,
      signature: hmac(key.key, hash),
      leaves: { leaves },
      retentionRuns: [],
    };
  });
}

interface Where {
  appId?: string;
  sealNo?: { gte: bigint };
  windowTo?: { lte: Date };
  recordedAt?: { gte?: Date; lt: Date };
}

function fakePrisma(seals: FakeSeal[], events: Stored[]) {
  const prisma = {
    integritySeal: {
      groupBy: vi.fn(() =>
        Promise.resolve(seals.length === 0 ? [] : [{ appId: APP, category: 'security' }]),
      ),
      findFirst: vi.fn(({ where, orderBy }: { where: Where; orderBy: { sealNo: string } }) => {
        const found = seals
          .filter((seal) => where.windowTo === undefined || seal.windowTo <= where.windowTo.lte)
          .sort((a, b) => Number(a.sealNo - b.sealNo));
        return Promise.resolve((orderBy.sealNo === 'desc' ? found.at(-1) : found[0]) ?? null);
      }),
      findMany: vi.fn(({ where }: { where: Where }) =>
        Promise.resolve(seals.filter((seal) => seal.sealNo >= (where.sealNo?.gte ?? 0n))),
      ),
    },
    auditEvent: {
      findMany: vi.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          events.filter(
            (event) =>
              (where.recordedAt?.gte === undefined || event.recordedAt >= where.recordedAt.gte) &&
              event.recordedAt < (where.recordedAt?.lt ?? new Date(8.64e15)),
          ),
        ),
      ),
    },
    integrityVerification: {
      create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'ver-1' })),
    },
  };
  return prisma;
}

function verifier(seals: FakeSeal[], events: Stored[], keyring = keys) {
  const prisma = fakePrisma(seals, events);
  return { prisma, service: new VerifierService(prisma as unknown as PrismaService, keyring) };
}

const kinds = (report: { failures: { kind: string }[] }) =>
  report.failures.map((failure) => failure.kind);

describe('VerifierService', () => {
  let events: Stored[];

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    events = [stored(1, 1_000), stored(2, 2_000), stored(3, 61_000)];
  });

  const windows = () => [[events[0], events[1]], [events[2]]] as Stored[][];

  it('passes an untouched chain and records the run', async () => {
    const { prisma, service } = verifier(chain(windows()), events);
    const report = await service.verify({ trigger: 'cli' });
    expect(report).toMatchObject({
      id: 'ver-1',
      outcome: 'passed',
      sealsChecked: 2,
      eventsChecked: 3,
      failures: [],
    });
    expect(prisma.integrityVerification.create.mock.calls[0]?.[0].data).toMatchObject({
      trigger: 'cli',
      scope: {},
      outcome: 'passed',
      eventsChecked: 3n,
      failures: 0,
    });
  });

  it('names an event whose columns were edited', async () => {
    const seals = chain(windows());
    const edited = events.map((event, index) =>
      index === 1 ? { ...event, actorId: 'someone-else' } : event,
    );
    const { prisma, service } = verifier(seals, edited);
    const report = await service.verify({ trigger: 'job', appId: APP });
    expect(report.outcome).toBe('failed');
    expect(report.failures).toEqual([
      {
        kind: 'event_modified',
        appId: APP,
        category: 'security',
        sealNo: '1',
        eventPk: events[1]?.id,
      },
    ]);
    expect(prisma.integrityVerification.create.mock.calls[0]?.[0].data).toMatchObject({
      scope: { appId: APP },
      outcome: 'failed',
      failureSample: [{ kind: 'event_modified', eventPk: events[1]?.id, sealNo: '1' }],
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `event_modified in ${APP}/security seal 1 event ${events[1]?.id ?? ''}`,
      ),
    );
  });

  it('notices an event recomputed with a new hash, which its seal no longer holds', async () => {
    const seals = chain(windows());
    const tampered = stored(2, 2_000);
    tampered.id = events[1]?.id ?? '';
    tampered.actorId = 'someone-else';
    const rehashed = { ...tampered, contentHash: sha256('forged') };
    const { service } = verifier(seals, [events[0], rehashed, events[2]] as Stored[]);
    expect(kinds(await service.verify({ trigger: 'cli' }))).toEqual(['event_modified']);
  });

  it('accepts deletions only as retention accounted for them', async () => {
    const seals = chain(windows());
    const remaining = [events[0], events[2]] as Stored[];
    const missing = await verifier(seals, remaining).service.verify({ trigger: 'cli' });
    expect(missing.failures).toEqual([
      {
        kind: 'event_deleted',
        appId: APP,
        category: 'security',
        sealNo: '1',
        eventPk: events[1]?.id,
      },
    ]);
    const purged = seals.map((seal) =>
      seal.sealNo === 1n ? { ...seal, retentionRuns: [{ deletedCount: 1 }] } : seal,
    );
    expect(kinds(await verifier(purged, remaining).service.verify({ trigger: 'cli' }))).toEqual([]);
    // Two missing and one accounted for: a deletion outside retention.
    const short = await verifier(purged, [events[2]] as Stored[]).service.verify({
      trigger: 'cli',
    });
    expect(short.failures).toEqual([
      { kind: 'event_deleted', appId: APP, category: 'security', sealNo: '1' },
    ]);
  });

  it('accounts for a window retention emptied, leaves and all', async () => {
    const seals = chain(windows()).map((seal) =>
      seal.sealNo === 1n ? { ...seal, leaves: null, retentionRuns: [{ deletedCount: 2 }] } : seal,
    );
    const remaining = [events[2]] as Stored[];
    expect(kinds(await verifier(seals, remaining).service.verify({ trigger: 'cli' }))).toEqual([]);
    const unaccounted = seals.map((seal) =>
      seal.sealNo === 1n ? { ...seal, retentionRuns: [{ deletedCount: 1 }] } : seal,
    );
    expect(
      kinds(await verifier(unaccounted, remaining).service.verify({ trigger: 'cli' })),
    ).toEqual(['event_deleted']);
    // An event written into a window whose leaves are gone.
    const reinserted = await verifier(seals, events).service.verify({ trigger: 'cli' });
    expect(kinds(reinserted)).toEqual(['event_inserted', 'event_inserted']);
  });

  it('names events added to a sealed window or before the first one', async () => {
    const seals = chain(windows());
    const added = stored(9, 30_000);
    const early = stored(10, -5_000);
    const report = await verifier(seals, [...events, added, early]).service.verify({
      trigger: 'cli',
    });
    expect(report.failures).toEqual([
      { kind: 'event_inserted', appId: APP, category: 'security', sealNo: '1', eventPk: added.id },
      { kind: 'event_inserted', appId: APP, category: 'security', eventPk: early.id },
    ]);
  });

  it('detects an edited seal, a broken chain, a missing seal and a gap between windows', async () => {
    const seals = chain([...windows(), []]);
    const edited = seals.map((seal) => (seal.sealNo === 1n ? { ...seal, eventCount: 1 } : seal));
    expect(kinds(await verifier(edited, events).service.verify({ trigger: 'cli' }))).toEqual([
      'seal_modified',
      'leaves_modified',
    ]);
    const relinked = seals.map((seal) =>
      seal.sealNo === 2n ? { ...seal, prevHash: sha256('another chain') } : seal,
    );
    expect(kinds(await verifier(relinked, events).service.verify({ trigger: 'cli' }))).toEqual([
      'chain_broken',
      'seal_modified',
    ]);
    const without = seals.filter((seal) => seal.sealNo !== 2n);
    expect(kinds(await verifier(without, events).service.verify({ trigger: 'cli' }))).toEqual([
      'seal_missing',
      'chain_broken',
      'window_gap',
    ]);
  });

  it('checks the leaves against their digest', async () => {
    const seals = chain(windows()).map((seal) =>
      seal.sealNo === 1n && seal.leaves !== null
        ? { ...seal, leaves: { leaves: seal.leaves.leaves.slice(0, 48) } }
        : seal,
    );
    expect(kinds(await verifier(seals, events).service.verify({ trigger: 'cli' }))).toEqual([
      'leaves_modified',
    ]);
  });

  it('verifies signatures with every configured key, and flags one nobody can verify', async () => {
    const seals = chain(windows());
    const forged = seals.map((seal) =>
      seal.sealNo === 2n ? { ...seal, signature: hmac(retired.current.key, seal.sealHash) } : seal,
    );
    expect(kinds(await verifier(forged, events).service.verify({ trigger: 'cli' }))).toEqual([
      'signature_invalid',
    ]);
    // Signed with a retired key: fine once a later seal verifies with a current one.
    const old = chain(windows(), retired.current);
    const rotated = [old[0], seals[1]] as FakeSeal[];
    expect(kinds(await verifier(rotated, events).service.verify({ trigger: 'cli' }))).toEqual([]);
    expect(kinds(await verifier(old, events).service.verify({ trigger: 'cli' }))).toEqual([
      'signature_unverifiable',
    ]);
    const both = integrityKeyring({
      key: 'k'.repeat(64),
      previous: 'r'.repeat(64),
      fallback: 'f'.repeat(64),
    });
    expect(kinds(await verifier(old, events, both).service.verify({ trigger: 'cli' }))).toEqual([]);
  });

  it('checks the personal rows against their digest', async () => {
    const seals = chain(windows());
    const edited = events.map((event, index) =>
      index === 0 && event.personal !== null
        ? { ...event, personal: { ...event.personal, actorLabel: 'x***@e***.com' } }
        : event,
    );
    expect(kinds(await verifier(seals, edited).service.verify({ trigger: 'cli' }))).toEqual([
      'personal_modified',
    ]);
    // Erased (the subject's right to erasure): the row is gone, the event stays verifiable.
    const erased = events.map((event) => ({ ...event, personal: null }));
    expect(kinds(await verifier(seals, erased).service.verify({ trigger: 'cli' }))).toEqual([]);
  });

  it('checks each device location at the decimals it was written with', async () => {
    // Approximate (two decimals, every row before precise ones existed) and precise (five).
    const approximate = stored(1, 1_000, { latitude: 19.43, longitude: -99.13, accuracyM: 3000 });
    const precise = stored(2, 2_000, { latitude: 19.43261, longitude: -99.13321, accuracyM: 5 });
    expect(approximate.location?.coordinateDecimals).toBe(2);
    expect(precise.location?.coordinateDecimals).toBe(5);
    const located = [approximate, precise, events[2]] as Stored[];
    const seals = chain([[approximate, precise], [events[2]]] as Stored[][]);
    expect(kinds(await verifier(seals, located).service.verify({ trigger: 'cli' }))).toEqual([]);
    // A precise position moved by a metre is a modified row.
    const moved = [
      approximate,
      {
        ...precise,
        location:
          precise.location === null
            ? null
            : { ...precise.location, latitude: new Prisma.Decimal('19.43262') },
      },
      events[2],
    ] as Stored[];
    expect(kinds(await verifier(seals, moved).service.verify({ trigger: 'cli' }))).toEqual([
      'location_modified',
    ]);
  });

  it('starts an incremental run from the last seal before `since`', async () => {
    const seals = chain(windows());
    const { prisma, service } = verifier(seals, events);
    const report = await service.verify({ trigger: 'job', since: new Date(T0 + 60_000) });
    expect(report).toMatchObject({ outcome: 'passed', sealsChecked: 1, eventsChecked: 1 });
    expect(prisma.integrityVerification.create.mock.calls[0]?.[0].data).toMatchObject({
      scope: { since: new Date(T0 + 60_000).toISOString() },
    });
  });

  it('passes when nothing is sealed yet', async () => {
    const { service } = verifier([], []);
    await expect(service.verify({ trigger: 'job' })).resolves.toMatchObject({
      outcome: 'passed',
      sealsChecked: 0,
    });
  });
});
