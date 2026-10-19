import type { ModuleMetadata, Provider } from '@nestjs/common';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module.js';
import { lockUser } from '../auth/sessions.service.js';
import { createExternalHttpClient, ExternalServiceError } from '../common/http/external-http.js';
import { LockService } from '../infrastructure/coordination/coordination.service.js';
import type { Prisma, PrismaClient } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CONFIG,
  AUDIT_HANDLERS,
  AUDIT_LOCK,
  AUDIT_PUSH,
  AUDIT_STORE,
  AUDIT_TRANSPORT,
} from './audit.constants.js';
import {
  type AuditHandlers,
  type AuditLock,
  type AuditPushSender,
  type AuditStore,
  type AuditTransport,
  AuditTransportError,
  type HubRequest,
  type HubResponse,
  type NewSecurityPrompt,
  type PromptAnswer,
  type PushMessage,
  type PushPlatform,
  type QueuedEvent,
  type QueueStats,
  type SecurityPrompt,
  type SequenceState,
} from './audit.ports.js';
import type { AuditEventDraft } from './contract/index.js';
import type { AuditTx } from './host.js';

// The connector's ports, implemented with this project's services
// (docs/adr/0009): Prisma for its tables, LockService so one instance
// forwards at a time, createExternalHttpClient for Audit Hub, and what the
// project does when Audit Hub asks. Created by `pnpm connector add` and never
// overwritten by an update: it is this project's code.

/** Audit Hub's answers wait at most this long. */
const HUB_TIMEOUT_MS = 10_000;
/** Expo's push service, as long. */
const PUSH_TIMEOUT_MS = 10_000;

/** What the store uses of Prisma: the API's PrismaService, or a CLI's own client. */
type AuditDb = Pick<
  PrismaClient,
  | '$transaction'
  | '$queryRaw'
  | 'auditOutbox'
  | 'auditWebhookReceipt'
  | 'auditSecurityPrompt'
  | 'auditPushToken'
>;

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: AuditDb) {}

  transaction<T>(work: (tx: AuditTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  async enqueue(tx: AuditTx, drafts: readonly AuditEventDraft[]): Promise<void> {
    await tx.auditOutbox.createMany({ data: drafts.map(rowOf) });
  }

  async enqueueAlone(drafts: readonly AuditEventDraft[]): Promise<Set<string>> {
    const rows = await this.prisma.auditOutbox.createManyAndReturn({
      data: drafts.map(rowOf),
      skipDuplicates: true,
      select: { eventId: true },
    });
    return new Set(rows.map((row) => row.eventId));
  }

  sequence(limit: number): Promise<SequenceState> {
    return this.prisma.$transaction(async (tx) => {
      // One numbering at a time across every instance, whatever the lock above.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('audit-outbox-sequence', 0))`;
      const state = await counterOf(tx);
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "audit_outbox" WHERE "source_seq" IS NULL ORDER BY "id" LIMIT ${limit}`;
      if (rows.length === 0) return state;
      const ids = rows.map((row) => row.id);
      await tx.$executeRaw`
        UPDATE "audit_outbox" AS o SET "source_seq" = n."seq", "updated_at" = now()
        FROM (SELECT "id", ${state.lastSeq}::bigint + row_number() OVER (ORDER BY "id") AS "seq"
              FROM "audit_outbox" WHERE "id" = ANY(${ids}::uuid[])) AS n
        WHERE o."id" = n."id"`;
      const lastSeq = state.lastSeq + rows.length;
      await tx.auditOutboxState.update({ where: { id: 1 }, data: { lastSeq: BigInt(lastSeq) } });
      return { epoch: state.epoch, lastSeq };
    });
  }

  state(): Promise<SequenceState> {
    return this.prisma.$transaction((tx) => counterOf(tx));
  }

  async claimDue(limit: number, now: Date, leaseMs: number): Promise<QueuedEvent[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; sourceSeq: bigint; attempts: number; payload: unknown }[]
    >`
      UPDATE "audit_outbox" SET "locked_until" = ${new Date(now.getTime() + leaseMs)}, "updated_at" = now()
      WHERE "id" IN (
        SELECT "id" FROM "audit_outbox"
        WHERE "source_seq" IS NOT NULL AND "next_attempt_at" <= ${now}
          AND ("locked_until" IS NULL OR "locked_until" < ${now})
        ORDER BY "source_seq" LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING "id", "source_seq" AS "sourceSeq", "attempts", "payload"`;
    return rows
      .map((row) => ({
        id: row.id,
        sourceSeq: Number(row.sourceSeq),
        attempts: row.attempts,
        draft: row.payload as AuditEventDraft,
      }))
      .sort((a, b) => a.sourceSeq - b.sourceSeq);
  }

  async remove(ids: readonly string[]): Promise<void> {
    await this.prisma.auditOutbox.deleteMany({ where: { id: { in: [...ids] } } });
  }

  async retryLater(
    ids: readonly string[],
    at: Date,
    error: string,
    failed: boolean,
  ): Promise<void> {
    await this.prisma.auditOutbox.updateMany({
      where: { id: { in: [...ids] } },
      data: {
        nextAttemptAt: at,
        lockedUntil: null,
        lastError: error.slice(0, 64),
        ...(failed ? { attempts: { increment: 1 } } : {}),
      },
    });
  }

  async stats(now: Date): Promise<QueueStats> {
    const [all, retrying] = await Promise.all([
      this.prisma.auditOutbox.aggregate({ _count: { _all: true }, _min: { createdAt: true } }),
      this.prisma.auditOutbox.count({ where: { attempts: { gt: 0 } } }),
    ]);
    const oldest = all._min.createdAt;
    return {
      size: all._count._all,
      oldestAgeSeconds:
        oldest === null ? 0 : Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000)),
      retrying,
    };
  }

  async firstReceipt(tx: AuditTx, id: string, type: string): Promise<boolean> {
    const { count } = await tx.auditWebhookReceipt.createMany({
      data: [{ id, type }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async forgetReceipts(before: Date): Promise<number> {
    const { count } = await this.prisma.auditWebhookReceipt.deleteMany({
      where: { receivedAt: { lt: before } },
    });
    return count;
  }

  async savePrompt(tx: AuditTx, prompt: NewSecurityPrompt): Promise<SecurityPrompt | null> {
    // A prompt about an account that is gone has no one to ask.
    const user = await tx.user.findUnique({ where: { id: prompt.userId }, select: { id: true } });
    if (user === null) return null;
    const { count } = await tx.auditSecurityPrompt.createMany({
      data: [prompt],
      skipDuplicates: true,
    });
    if (count === 0) return null;
    const saved = await tx.auditSecurityPrompt.findUniqueOrThrow({
      where: { webhookId: prompt.webhookId },
    });
    return promptOf(saved);
  }

  async openPrompts(userId: string, now: Date): Promise<SecurityPrompt[]> {
    const rows = await this.prisma.auditSecurityPrompt.findMany({
      where: { userId, answer: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(promptOf);
  }

  async answerPrompt(
    tx: AuditTx,
    userId: string,
    id: string,
    answer: PromptAnswer,
    now: Date,
  ): Promise<SecurityPrompt | null> {
    const { count } = await tx.auditSecurityPrompt.updateMany({
      where: { id, userId, answer: null, expiresAt: { gt: now } },
      data: { answer, answeredAt: now },
    });
    if (count === 0) return null;
    return promptOf(await tx.auditSecurityPrompt.findUniqueOrThrow({ where: { id } }));
  }

  async forgetPrompts(before: Date): Promise<number> {
    const { count } = await this.prisma.auditSecurityPrompt.deleteMany({
      where: { OR: [{ answeredAt: { lt: before } }, { expiresAt: { lt: before } }] },
    });
    return count;
  }

  async savePushToken(userId: string, token: string, platform: PushPlatform): Promise<void> {
    // The token is unique: the account signed in on the phone last takes it.
    await this.prisma.auditPushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async deletePushToken(userId: string, token: string): Promise<boolean> {
    const { count } = await this.prisma.auditPushToken.deleteMany({ where: { userId, token } });
    return count > 0;
  }

  async pushTokensOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.auditPushToken.findMany({
      where: { userId },
      select: { token: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.token);
  }

  async forgetPushTokens(tokens: readonly string[]): Promise<number> {
    const { count } = await this.prisma.auditPushToken.deleteMany({
      where: { token: { in: [...tokens] } },
    });
    return count;
  }
}

function rowOf(draft: AuditEventDraft): Prisma.AuditOutboxCreateManyInput {
  return { eventId: draft.eventId, payload: draft };
}

/** The sequence counter, created with a new epoch when missing (a fresh or restored database). */
async function counterOf(tx: Prisma.TransactionClient): Promise<SequenceState> {
  await tx.$executeRaw`
    INSERT INTO "audit_outbox_state" ("id", "epoch", "last_seq", "created_at", "updated_at")
    VALUES (1, gen_random_uuid(), 0, now(), now()) ON CONFLICT ("id") DO NOTHING`;
  const rows = await tx.$queryRaw<{ epoch: string; lastSeq: bigint }[]>`
    SELECT "epoch"::text AS "epoch", "last_seq" AS "lastSeq" FROM "audit_outbox_state" WHERE "id" = 1 FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new Error('The audit outbox counter is missing');
  return { epoch: row.epoch, lastSeq: Number(row.lastSeq) };
}

function promptOf(row: {
  id: string;
  userId: string;
  hubEventId: string;
  signals: string[];
  context: Prisma.JsonValue;
  expiresAt: Date;
  answer: string | null;
  answeredAt: Date | null;
  createdAt: Date;
}): SecurityPrompt {
  return {
    id: row.id,
    userId: row.userId,
    hubEventId: row.hubEventId,
    signals: row.signals,
    context: (row.context ?? {}) as Record<string, string>,
    expiresAt: row.expiresAt,
    answer: row.answer === 'confirmed' || row.answer === 'not_me' ? row.answer : null,
    answeredAt: row.answeredAt,
    createdAt: row.createdAt,
  };
}

/** Audit Hub over createExternalHttpClient: one client per request, so each keeps its own answer. */
function hubTransport(config: AuditConfig | null): AuditTransport {
  return {
    async send(request: HubRequest): Promise<HubResponse> {
      if (config === null) throw new Error('The Audit Hub connector is off');
      let answered: Response | undefined;
      const client = createExternalHttpClient({
        name: 'audit-hub',
        baseUrl: `${config.hubUrl}/`,
        timeoutMs: HUB_TIMEOUT_MS,
        // The forwarder retries with its own backoff and Retry-After.
        retries: 0,
        headers: () => request.headers,
        fetch: async (input, init) => {
          answered = await fetch(input, init);
          return answered;
        },
      });
      try {
        const response = await client.request({
          method: request.method,
          // Segments, each encoded: the path the request was signed with.
          path: request.path.split('/').filter(Boolean).map(decodeURIComponent),
          ...(request.query === undefined ? {} : { query: request.query }),
          ...(request.body === undefined ? {} : { body: request.body }),
          idempotent: request.method !== 'POST',
        });
        return { status: response.status, body: response.body };
      } catch (error) {
        if (!(error instanceof ExternalServiceError)) throw error;
        if (error.kind !== 'status') throw new AuditTransportError(error.kind, { cause: error });
        const retryAfter = Number.parseInt(answered?.headers.get('Retry-After') ?? '', 10);
        return {
          status: error.status ?? 502,
          ...(Number.isInteger(retryAfter) && retryAfter >= 0 ? { retryAfterSec: retryAfter } : {}),
          body: null,
        };
      }
    },
  };
}

/** Expo's answer to a push: one ticket per message, in their order. */
const ExpoTickets = z.object({
  data: z.array(
    z.object({
      status: z.enum(['ok', 'error']),
      details: z.object({ error: z.string().optional() }).optional(),
    }),
  ),
});

/**
 * "Was it you?" through Expo's push service (docs/adr/0013), with the
 * project's HTTP client: high priority on Android's `security` channel,
 * carrying only the screen it opens. Tokens Expo reports as no longer
 * registered (`DeviceNotRegistered`) are answered, to be forgotten.
 */
export function expoPushSender(
  accessToken: string | undefined,
  fetchImpl?: typeof fetch,
): AuditPushSender {
  const client = createExternalHttpClient({
    name: 'expo-push',
    baseUrl: 'https://exp.host/--/api/v2',
    timeoutMs: PUSH_TIMEOUT_MS,
    headers: (): Record<string, string> =>
      accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` },
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  return {
    async send(tokens: readonly string[], message: PushMessage) {
      const response = await client.request({
        method: 'POST',
        path: ['push', 'send'],
        body: tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: { url: message.url },
          channelId: 'security',
          priority: 'high',
          sound: 'default',
        })),
      });
      const tickets = ExpoTickets.parse(response.body).data;
      return {
        unregistered: tokens.filter(
          (_, index) => tickets[index]?.details?.error === 'DeviceNotRegistered',
        ),
      };
    },
  };
}

/** One forwarder at a time across instances (with Redis; the numbering also locks the database). */
function lockOf(locks: LockService): AuditLock {
  return {
    async withLock(name, ttlMs, work) {
      return (await locks.withLock(name, ttlMs, work)).acquired;
    },
  };
}

/**
 * Ends every session of a user and, through securityVersion, their access
 * tokens at once: Audit Hub's revoke_sessions, and "it was not me".
 */
async function endSessions(tx: AuditTx, userId: string): Promise<'succeeded' | 'refused'> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (user === null) return 'refused';
  await lockUser(tx, userId);
  await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.user.update({ where: { id: userId }, data: { securityVersion: { increment: 1 } } });
  return 'succeeded';
}

/**
 * What this project does when Audit Hub asks (docs/audit/connection-guide.md#response-actions).
 * A response action runs only when also listed in AUDIT_HUB_RESPONSE_ACTIONS.
 */
const handlers: AuditHandlers = {
  responseActions: {
    revoke_sessions: endSessions,
  },
  onNotMe: async (tx, userId) => {
    await endSessions(tx, userId);
  },
};

export const auditWiring: {
  imports: NonNullable<ModuleMetadata['imports']>;
  providers: Provider[];
} = {
  // The routes' @Auth() guard: JwtService, as in every module with signed-in routes.
  imports: [AuthModule],
  providers: [
    {
      provide: AUDIT_STORE,
      useFactory: (prisma: PrismaService) => new PrismaAuditStore(prisma),
      inject: [PrismaService],
    },
    { provide: AUDIT_TRANSPORT, useFactory: hubTransport, inject: [AUDIT_CONFIG] },
    { provide: AUDIT_LOCK, useFactory: lockOf, inject: [LockService] },
    { provide: AUDIT_HANDLERS, useValue: handlers },
    // The push module: off unless AUDIT_HUB_PUSH=expo.
    {
      provide: AUDIT_PUSH,
      useFactory: (config: AuditConfig | null) =>
        config?.push == null ? null : expoPushSender(config.push.accessToken),
      inject: [AUDIT_CONFIG],
    },
  ],
};
