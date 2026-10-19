import { Prisma } from '../prisma/generated/client.js';

/** What the lookups need: the client, or a transaction (the rules read inside theirs). */
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;

// The subjects blocked after an erasure (LFPDPPP art. 24, docs/privacy/): in
// an application where a subject has an erasure run, what is kept of the
// events that occurred up to their last erasure is never processed for that
// person, unless an active legal hold names them (the legal exception it is
// kept for). The per-person reads leave those events out: the subject's
// view, a search by their id or their email (and its export), the same
// person found in other applications, and the query API's activity and
// export; what the subject does afterwards (an account that stays) is new
// data, shown as any other. Searches by anything else still find the blocked
// events, pseudonymous, which keep the log whole for security
// investigations; an event's detail says its user is blocked.

/** A subject's block in one application: since its first erasure, over what occurred up to its last. */
export interface Block {
  since: Date;
  through: Date;
}

/** An application where a subject is blocked, through its last erasure. */
export interface BlockedApp {
  appId: string;
  through: Date;
}

/** A subject blocked in an application, through its last erasure there. */
export interface BlockedSubject {
  appId: string;
  subject: string;
  through: Date;
}

/** No active hold names the erasure run r's subject in its application. */
const NOT_HELD = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "legal_holds" h
  WHERE h."app_id" = r."app_id"
    AND (h."actor_id" = r."subject" OR (h."resource_type" = 'user' AND h."resource_id" = r."subject"))
    AND NOT EXISTS (SELECT 1 FROM "legal_hold_releases" x WHERE x."hold_id" = h."id"))`;

/** The email pseudonym columns: the application's own, and the one shared across applications. */
const EMAIL_COLUMNS = {
  own: Prisma.raw('"actor_email_hmac"'),
  shared: Prisma.raw('"actor_email_hmac_shared"'),
} as const;

async function blocks(
  prisma: Reader,
  subject: string,
  appId: string | null,
): Promise<(Block & { appId: string })[]> {
  return prisma.$queryRaw<(Block & { appId: string })[]>`
    SELECT r."app_id" AS "appId", min(r."created_at") AS "since", max(r."created_at") AS "through"
    FROM "erasure_runs" r
    WHERE r."subject" = ${subject} AND (${appId}::uuid IS NULL OR r."app_id" = ${appId}::uuid)
      AND ${NOT_HELD}
    GROUP BY r."app_id"`;
}

/** The subject's block in the application; null when not blocked there. */
export async function blockOf(
  prisma: Reader,
  appId: string,
  subject: string,
): Promise<Block | null> {
  const [row] = await blocks(prisma, subject, appId);
  return row === undefined ? null : { since: row.since, through: row.through };
}

/** Whether an event that occurred at `occurredAt` falls under the block. */
export const isBlocked = (block: Block | null, occurredAt: Date): block is Block =>
  block !== null && occurredAt.getTime() <= block.through.getTime();

/** The applications where the subject is blocked. */
export async function blockedApps(prisma: Reader, subject: string): Promise<BlockedApp[]> {
  return (await blocks(prisma, subject, null)).map(({ appId, through }) => ({ appId, through }));
}

/**
 * The subjects blocked in these applications whose events carry one of the
 * email pseudonyms (`own`: each application's; `shared`: the one shared
 * across applications), for a search by email and for the same person found
 * in other applications.
 */
export async function blockedWithEmail(
  prisma: Reader,
  appIds: string[],
  pseudonyms: string[],
  column: keyof typeof EMAIL_COLUMNS,
): Promise<BlockedSubject[]> {
  if (appIds.length === 0 || pseudonyms.length === 0) return [];
  return prisma.$queryRaw<BlockedSubject[]>`
    SELECT r."app_id" AS "appId", r."subject", max(r."created_at") AS "through"
    FROM "erasure_runs" r
    WHERE r."app_id" = ANY(${appIds}::uuid[]) AND ${NOT_HELD}
      AND EXISTS (
        SELECT 1 FROM "audit_events" e
        WHERE e."app_id" = r."app_id" AND e."actor_id" = r."subject"
          AND e.${EMAIL_COLUMNS[column]} = ANY(${pseudonyms}::text[]))
    GROUP BY r."app_id", r."subject"`;
}

/** Leaves out of a query what occurred up to each block, in its application. */
export function withoutBlocked(apps: BlockedApp[]): Prisma.AuditEventWhereInput[] {
  return apps.length === 0
    ? []
    : [
        {
          NOT: {
            OR: apps.map(({ appId, through }) => ({ appId, occurredAt: { lte: through } })),
          },
        },
      ];
}

/** Leaves out of a query what each blocked subject did up to their block, in its application. */
export function withoutSubjects(subjects: BlockedSubject[]): Prisma.AuditEventWhereInput[] {
  return subjects.length === 0
    ? []
    : [
        {
          NOT: {
            OR: subjects.map(({ appId, subject, through }) => ({
              appId,
              actorId: subject,
              occurredAt: { lte: through },
            })),
          },
        },
      ];
}

/**
 * Of these applications, those where someone with one of the shared email
 * pseudonyms appears, not counting what a blocked subject did up to their
 * block.
 */
export async function presentUnblocked(
  prisma: Reader,
  appIds: string[],
  pseudonyms: string[],
): Promise<string[]> {
  if (appIds.length === 0 || pseudonyms.length === 0) return [];
  const rows = await prisma.$queryRaw<{ appId: string }[]>`
    SELECT a."id" AS "appId" FROM unnest(${appIds}::uuid[]) AS a("id")
    WHERE EXISTS (
      SELECT 1 FROM "audit_events" e
      WHERE e."actor_email_hmac_shared" = ANY(${pseudonyms}::text[]) AND e."app_id" = a."id"
        AND NOT EXISTS (
          SELECT 1 FROM "erasure_runs" r
          WHERE r."app_id" = e."app_id" AND r."subject" = e."actor_id"
            AND r."created_at" >= e."occurred_at" AND ${NOT_HELD}))`;
  return rows.map((row) => row.appId);
}
