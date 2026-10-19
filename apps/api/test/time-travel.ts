import { contentHashOf, type EventRow } from '../src/ingest/event-rows.js';
import type { Prisma } from '../src/prisma/generated/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

// The audit log's clock belongs to the database (recorded_at, docs/adr/0008),
// and the jobs that read it wait on purpose: sealing takes windows 2 minutes
// old, the real-time rules events 20 s old, retention whole periods. The
// suites move events back in time instead of waiting, as the superuser past
// the triggers (session_replication_role = replica), each hash recomputed as
// ingestion would have computed it then.

/** As the superuser, past the triggers (an attacker with the database's keys). */
export function bypassingTriggers<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    return work(tx);
  });
}

/** Moves events to another recorded_at, their content hash recomputed. */
export async function moveEvents(
  prisma: PrismaService,
  ids: readonly string[],
  to: (recordedAt: Date) => Date,
): Promise<void> {
  await bypassingTriggers(prisma, async (tx) => {
    for (const id of ids) {
      const row = await tx.auditEvent.findUniqueOrThrow({ where: { id } });
      const recordedAt = to(row.recordedAt);
      const contentHash = contentHashOf({ ...row, recordedAt } as unknown as EventRow);
      await tx.auditEvent.update({ where: { id }, data: { recordedAt, contentHash } });
      await tx.eventPersonal.updateMany({ where: { eventPk: id }, data: { recordedAt } });
      await tx.eventLocation.updateMany({ where: { eventPk: id }, data: { recordedAt } });
    }
  });
}

/** Moves events `ms` back in time. */
export function ageEvents(prisma: PrismaService, ids: readonly string[], ms: number) {
  return moveEvents(prisma, ids, (recordedAt) => new Date(recordedAt.getTime() - ms));
}
