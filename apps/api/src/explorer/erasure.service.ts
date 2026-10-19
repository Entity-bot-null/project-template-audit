import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ErasureResult, ErasureScope } from 'audit-contract';
import type { Request } from 'express';
import { type HubActor, HubAuditService } from '../hub-audit/hub-audit.service.js';
import { LOCK_NOT_AVAILABLE, rawQuerySqlState } from '../prisma/postgres-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The right to erasure (docs/security.md#audit-log-integrity-retention-and-erasure):
// the database's audit_erase_subject() deletes the satellite rows of every
// event of the subject except what a legal hold keeps, and records the run.
// In the personal scope the events stay, pseudonymous (and the subject is
// blocked in the per-person views); in the events scope, audit_delete_events()
// deletes them too: the sealed ones now, the rest as they are sealed (the
// daily retention sweep, completePendingErasures). Asked from the admin pages
// (panel), by the application through the query API (connector), or by an
// account deletion event (rules/realtime-rules.service.ts).

/** Events deleted per call of audit_delete_events: one batch, its own short transaction. */
const DELETE_BATCH = 5000;
@Injectable()
export class ErasureService {
  private readonly logger = new Logger('Erasure');

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubAudit: HubAuditService,
  ) {}

  async erase(
    appId: string,
    subject: string,
    via: 'panel' | 'connector',
    by: { actor: HubActor; request?: Request },
    scope: ErasureScope = 'personal',
  ): Promise<ErasureResult> {
    const app = await this.prisma.connectedApp.findFirst({
      where: { id: appId, system: false },
      select: { id: true },
    });
    if (app === null) throw new NotFoundException('Application not found');
    const [row] = await this.prisma.$queryRaw<
      { run_id: string; personal_deleted: number; location_deleted: number; held: number }[]
    >`SELECT * FROM audit_erase_subject(${appId}::uuid, ${subject}, ${via}, ${scope})`;
    const result: ErasureResult = {
      personalDeleted: row?.personal_deleted ?? 0,
      locationDeleted: row?.location_deleted ?? 0,
      held: row?.held ?? 0,
    };
    if (scope === 'events' && row !== undefined) {
      const events = await deleteEvents(this.prisma, appId, row.run_id);
      result.eventsDeleted = events.deleted;
      // Busy: another deletion in the application; the daily sweep does the rest.
      result.eventsPending = events.busy
        ? await undeletedEvents(this.prisma, appId, subject)
        : events.unsealed;
    }
    await this.hubAudit.recordQuietly({
      action: 'hub.subject.erased',
      actor: by.actor,
      resource: { type: 'app_user', id: subject },
      details: {
        appId,
        via,
        scope,
        personalDeleted: result.personalDeleted,
        held: result.held,
        ...(result.eventsDeleted === undefined ? {} : { eventsDeleted: result.eventsDeleted }),
      },
      ...(by.request === undefined ? {} : { request: by.request }),
    });
    this.logger.log(
      `Erasure in application ${appId} (${via}, ${scope}): ${String(result.personalDeleted)} personal and ${String(result.locationDeleted)} location rows deleted, ${String(result.eventsDeleted ?? 0)} events, ${String(result.eventsPending ?? 0)} waiting for their seal, ${String(result.held)} held`,
    );
    return result;
  }
}

/**
 * Deletes the events in an erasure's scope (erasure: its run) or, without
 * one, every event of a suspended application, batch by batch, until a batch
 * deletes nothing: answers the total, what a hold keeps and what waits for
 * its seal. Busy: another deletion in the application held the database's
 * lock past 5 seconds, and the rest is left for a later call.
 */
export async function deleteEvents(
  prisma: PrismaService,
  appId: string,
  erasure: string | null,
): Promise<{ deleted: number; held: number; unsealed: number; busy: boolean }> {
  let deleted = 0;
  for (;;) {
    let row: { deleted: number; held: number; unsealed: number } | undefined;
    try {
      [row] = await prisma.$queryRaw<{ deleted: number; held: number; unsealed: number }[]>`
        SELECT * FROM audit_delete_events(${appId}::uuid, ${erasure}::uuid, ${DELETE_BATCH})`;
    } catch (error) {
      if (rawQuerySqlState(error) !== LOCK_NOT_AVAILABLE) throw error;
      return { deleted, held: 0, unsealed: 0, busy: true };
    }
    deleted += row?.deleted ?? 0;
    if ((row?.deleted ?? 0) < DELETE_BATCH) {
      return { deleted, held: row?.held ?? 0, unsealed: row?.unsealed ?? 0, busy: false };
    }
  }
}

/** The subject's events in the application that no hold keeps: what an erasure still deletes. */
async function undeletedEvents(
  prisma: PrismaService,
  appId: string,
  subject: string,
): Promise<number> {
  const [row] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::integer AS "count" FROM "audit_events" e
    WHERE e."app_id" = ${appId}::uuid
      AND (e."actor_id" = ${subject} OR (e."resource_type" = 'user' AND e."resource_id" = ${subject}))
      AND NOT audit_event_held(e)`;
  return row?.count ?? 0;
}

/**
 * The erasures of scope events whose subject still has events that no hold
 * keeps (sealed since, or ingested late): deleted now. Run by the daily
 * retention sweep; answers how many events went.
 */
export async function completePendingErasures(prisma: PrismaService): Promise<number> {
  const pending = await prisma.$queryRaw<{ id: string; appId: string }[]>`
    SELECT r."id", r."app_id" AS "appId" FROM "erasure_runs" r
    WHERE r."scope" = 'events' AND EXISTS (
      SELECT 1 FROM "audit_events" e
      WHERE e."app_id" = r."app_id"
        AND (e."actor_id" = r."subject" OR (e."resource_type" = 'user' AND e."resource_id" = r."subject"))
        AND NOT audit_event_held(e))`;
  let total = 0;
  for (const run of pending) total += (await deleteEvents(prisma, run.appId, run.id)).deleted;
  return total;
}
