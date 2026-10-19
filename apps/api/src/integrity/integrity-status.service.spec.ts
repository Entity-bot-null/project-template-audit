import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { IntegrityStatusService } from './integrity-status.service.js';

const AT = new Date('2026-10-14T12:00:00.000Z');

describe('IntegrityStatusService', () => {
  it('reports each stream, the latest verifications and the last checkpoint', async () => {
    const prisma = {
      $queryRaw: vi.fn(() =>
        Promise.resolve([
          {
            appId: '0199e0b1-0000-7000-8000-000000000001',
            slug: 'my-project',
            category: 'security',
            lastSealNo: 12n,
            sealedThrough: AT,
            unsealedEvents: 3n,
          },
          {
            appId: '0199e0b1-0000-7000-8000-000000000001',
            slug: 'my-project',
            category: 'audit',
            lastSealNo: null,
            sealedThrough: null,
            unsealedEvents: 1n,
          },
        ]),
      ),
      integrityVerification: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: 'ver-1',
              trigger: 'job',
              outcome: 'failed',
              sealsChecked: 4,
              eventsChecked: 120n,
              failures: 1,
              failureSample: [{ kind: 'event_modified', eventPk: 'e1' }],
              startedAt: AT,
              finishedAt: AT,
            },
            {
              id: 'ver-2',
              trigger: 'cli',
              outcome: 'passed',
              sealsChecked: 4,
              eventsChecked: 120n,
              failures: 0,
              failureSample: null,
              startedAt: AT,
              finishedAt: AT,
            },
          ]),
        ),
      },
      integrityCheckpoint: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'cp-1',
            digest: new Uint8Array([0xab, 0xcd]),
            createdAt: AT,
          })
          .mockResolvedValueOnce(null),
      },
    };
    const service = new IntegrityStatusService(prisma as unknown as PrismaService);
    const status = await service.status();
    expect(status.streams).toEqual([
      expect.objectContaining({
        lastSealNo: '12',
        sealedThrough: AT.toISOString(),
        unsealedEvents: 3,
      }),
      expect.objectContaining({ lastSealNo: null, sealedThrough: null, unsealedEvents: 1 }),
    ]);
    expect(
      status.verifications.map((run) => [run.outcome, run.eventsChecked, run.failureSample]),
    ).toEqual([
      ['failed', '120', [{ kind: 'event_modified', eventPk: 'e1' }]],
      ['passed', '120', null],
    ]);
    expect(status.lastCheckpoint).toEqual({
      id: 'cp-1',
      digest: 'abcd',
      createdAt: AT.toISOString(),
    });
    await expect(service.status()).resolves.toMatchObject({ lastCheckpoint: null });
  });
});
