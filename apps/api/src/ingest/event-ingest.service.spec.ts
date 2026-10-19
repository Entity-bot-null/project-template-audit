import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testCatalog, testEvent } from '../../test/ingest.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { NO_GEOIP } from '../enrichment/geoip.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogService, ResolvedCatalog } from './catalog.service.js';
import { EventIngestService } from './event-ingest.service.js';

// The transaction against PostgreSQL is in ingest.int.spec.ts; here, the
// decisions: what is accepted, duplicate, rejected, and what is written.

const VERSION = '0123456789abcdef';
const APP = { appId: 'app-1', slug: 'my-project', keyId: 'k1' };
const CATALOG: ResolvedCatalog = {
  id: 'cat-1',
  actions: new Map(Object.entries(testCatalog().actions)),
};

function setup(options: { inserted?: (ids: string[]) => string[]; existing?: unknown[] } = {}) {
  const writes: string[] = [];
  const tx = {
    $executeRaw: vi.fn(() => {
      writes.push('sql');
      return Promise.resolve(1);
    }),
    $queryRaw: vi.fn(() => Promise.resolve([{ now: new Date() }])),
    auditEvent: {
      createManyAndReturn: vi.fn((args: { data: { eventId: string }[] }) => {
        const ids = args.data.map((row) => row.eventId);
        return Promise.resolve(
          (options.inserted ?? ((all: string[]) => all))(ids).map((eventId) => ({ eventId })),
        );
      }),
      findMany: vi.fn(() => Promise.resolve(options.existing ?? [])),
    },
    eventPersonal: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    eventLocation: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    ingestException: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const catalogs = {
    resolve: vi.fn((_appId: string, version: string) =>
      Promise.resolve(version === VERSION ? CATALOG : undefined),
    ),
  };
  const service = new EventIngestService(
    prisma as unknown as PrismaService,
    catalogs as unknown as CatalogService,
    new EnrichmentService(NO_GEOIP, new Set()),
  );
  return { tx, catalogs, service, writes };
}

const batch = (events: unknown[]) => ({
  connector: { name: 'audit-nestjs', version: '0.1.0' },
  sequenceEpoch: '0199e0b1-0000-7000-8000-0000000000e1',
  events,
});

describe('EventIngestService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('accepts valid events with their satellite rows, inside a bounded transaction', async () => {
    const { tx, service } = setup();
    const located = testEvent(VERSION, 2, {
      location: {
        latitude: 19.43,
        longitude: -99.13,
        accuracyM: 1000,
        capturedAt: new Date().toISOString(),
      },
    });
    const result = await service.ingest(APP, batch([testEvent(VERSION, 1), located]));
    expect(result).toMatchObject({ accepted: 2, duplicates: 0, rejected: 0 });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.eventPersonal.createMany).toHaveBeenCalled();
    expect(tx.eventLocation.createMany).toHaveBeenCalled();
    expect(tx.ingestException.createMany).not.toHaveBeenCalled();
  });

  it('rejects per event, consuming the numbers of all but retryable rejections', async () => {
    const { tx, service } = setup();
    const result = await service.ingest(
      APP,
      batch([
        { eventId: 'x' },
        testEvent('ffffffffffffffff', 2),
        testEvent(VERSION, 3, { action: 'not.in.catalog' }),
        testEvent(VERSION, 4, { category: 'audit' }),
      ]),
    );
    expect(result.results.map((entry) => entry.reason)).toEqual([
      'schema_invalid',
      'catalog_version_unknown',
      'action_unknown',
      'category_mismatch',
    ]);
    const rows = (
      tx.ingestException.createMany.mock.calls[0] as unknown as [
        { data: { sourceSeq: bigint | null }[] },
      ]
    )[0].data;
    expect(rows.map((row) => row.sourceSeq)).toEqual([null, 3n, 4n]);
  });

  it('tells a repeated event from a sequence conflict', async () => {
    const repeated = testEvent(VERSION, 5);
    const renumbered = testEvent(VERSION, 6);
    const conflicting = testEvent(VERSION, 7);
    const { tx, service } = setup({
      inserted: () => [],
      existing: [
        {
          eventId: repeated.eventId,
          sequenceEpoch: '0199e0b1-0000-7000-8000-0000000000e1',
          sourceSeq: 5n,
        },
        {
          eventId: renumbered.eventId,
          sequenceEpoch: '0199e0b1-0000-7000-8000-0000000000e1',
          sourceSeq: 2n,
        },
      ],
    });
    const result = await service.ingest(APP, batch([repeated, renumbered, conflicting, repeated]));
    expect(result.results.map((entry) => entry.reason ?? entry.status)).toEqual([
      'duplicate',
      'duplicate',
      'sequence_conflict',
      'duplicate',
    ]);
    const rows = (
      tx.ingestException.createMany.mock.calls[0] as unknown as [
        { data: { kind: string; sourceSeq: bigint }[] },
      ]
    )[0].data;
    expect(rows.map((row) => [row.kind, row.sourceSeq])).toEqual([
      ['duplicate', 6n],
      ['rejected', 7n],
    ]);
    expect(tx.eventPersonal.createMany).not.toHaveBeenCalled();
  });

  it('writes nothing but the bookkeeping when every event is refused', async () => {
    const { tx, service } = setup();
    const result = await service.ingest(APP, batch([testEvent('ffffffffffffffff', 1)]));
    expect(result).toMatchObject({ accepted: 0, rejected: 1 });
    expect(tx.auditEvent.createManyAndReturn).not.toHaveBeenCalled();
    // Only a retryable rejection: no number consumed, no sequence state touched.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
