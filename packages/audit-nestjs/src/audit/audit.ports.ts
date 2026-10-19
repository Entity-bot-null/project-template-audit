import type { AlertCreatedDataSchema, AuditEventDraft, ResponseAction } from './contract/index.js';
import type { AuditTx } from './host.js';
import type { z } from 'zod';

// What the connector needs from the project, implemented once in
// audit.wiring.ts with the project's own services (docs/adr/0009): its
// database (Prisma), its lock (LockService), its HTTP client
// (createExternalHttpClient) and what it does when Audit Hub asks.

/** A queued event, numbered, as the forwarder sends it. */
export interface QueuedEvent {
  id: string;
  sourceSeq: number;
  attempts: number;
  draft: AuditEventDraft;
}

export interface QueueStats {
  /** Rows waiting, numbered or not. */
  size: number;
  /** Age of the oldest row, 0 when empty. */
  oldestAgeSeconds: number;
  /** Rows Audit Hub failed on at least once: an outage's wait counts no attempt. */
  retrying: number;
}

/** The sequence: its epoch changes when the counter row is created again (a restore). */
export interface SequenceState {
  epoch: string;
  lastSeq: number;
}

export type PromptAnswer = 'confirmed' | 'not_me';

export interface SecurityPrompt {
  id: string;
  userId: string;
  hubEventId: string;
  signals: string[];
  /** Country, city, client type, device model: never an IP. */
  context: Record<string, string>;
  expiresAt: Date;
  answer: PromptAnswer | null;
  answeredAt: Date | null;
  createdAt: Date;
}

export interface NewSecurityPrompt {
  userId: string;
  webhookId: string;
  hubEventId: string;
  signals: string[];
  context: Record<string, string>;
  expiresAt: Date;
}

export type PushPlatform = 'ios' | 'android';

/** What a push says: a title, a line, and the screen it opens (never an action). */
export interface PushMessage {
  title: string;
  body: string;
  /** An internal path of the app, e.g. /security/prompts/<id>. */
  url: string;
}

/**
 * The connector's tables (audit_outbox, audit_outbox_state,
 * audit_webhook_receipts, audit_security_prompts, audit_push_tokens).
 */
export interface AuditStore {
  /** Runs `work` in a transaction of its own. */
  transaction<T>(work: (tx: AuditTx) => Promise<T>): Promise<T>;
  /** Queues events in the caller's transaction: they commit with it, or not at all. */
  enqueue(tx: AuditTx, drafts: readonly AuditEventDraft[]): Promise<void>;
  /** Queues events on their own; an eventId already queued is skipped. Answers the ids queued. */
  enqueueAlone(drafts: readonly AuditEventDraft[]): Promise<Set<string>>;
  /**
   * Numbers the rows not numbered yet, in id order, gapless, up to `limit`,
   * with the counter in the same transaction (a rollback gives the numbers
   * back) and a database lock (one numbering at a time, whatever the
   * instances). Creates the counter, and its epoch, on the first call.
   */
  sequence(limit: number): Promise<SequenceState>;
  /** The counter as it is; created like `sequence` does when missing. */
  state(): Promise<SequenceState>;
  /** Numbered rows due by `now`, lowest number first, leased until `now + leaseMs`. */
  claimDue(limit: number, now: Date, leaseMs: number): Promise<QueuedEvent[]>;
  /** Rows Audit Hub answered for: gone. */
  remove(ids: readonly string[]): Promise<void>;
  /** Rows to send again at `at`; `failed` counts an attempt against each. */
  retryLater(ids: readonly string[], at: Date, error: string, failed: boolean): Promise<void>;
  stats(now: Date): Promise<QueueStats>;
  /** Records a webhook delivery in `tx`: false when it was handled before. */
  firstReceipt(tx: AuditTx, id: string, type: string): Promise<boolean>;
  forgetReceipts(before: Date): Promise<number>;
  /** Idempotent by webhook id: false when it was there already. */
  savePrompt(tx: AuditTx, prompt: NewSecurityPrompt): Promise<SecurityPrompt | null>;
  openPrompts(userId: string, now: Date): Promise<SecurityPrompt[]>;
  /** The user's open prompt, answered in `tx`; null when not theirs, answered or expired. */
  answerPrompt(
    tx: AuditTx,
    userId: string,
    id: string,
    answer: PromptAnswer,
    now: Date,
  ): Promise<SecurityPrompt | null>;
  /** Answered or expired prompts older than `before`. */
  forgetPrompts(before: Date): Promise<number>;
  /**
   * A phone of the user's, for pushes. A token belongs to one account: the
   * last one signed in on that phone takes it.
   */
  savePushToken(userId: string, token: string, platform: PushPlatform): Promise<void>;
  /** The user's token gone (signed out on that phone); false when it was not theirs. */
  deletePushToken(userId: string, token: string): Promise<boolean>;
  pushTokensOf(userId: string): Promise<string[]>;
  /** Tokens the push service no longer knows. */
  forgetPushTokens(tokens: readonly string[]): Promise<number>;
}

/** Push notifications: Expo's push service, through the project's HTTP client. */
export interface AuditPushSender {
  /** Sends `message` to each token; answers the tokens no longer registered, to forget. */
  send(tokens: readonly string[], message: PushMessage): Promise<{ unregistered: string[] }>;
}

/** Audit Hub's answer: no answer at all is an AuditTransportError. */
export interface HubResponse {
  status: number;
  /** From Retry-After on a 429 or 503. */
  retryAfterSec?: number;
  body: unknown;
}

export interface HubRequest {
  method: 'GET' | 'POST' | 'PUT';
  /** Under the hub's origin, e.g. /api/ingest/events. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers: Record<string, string>;
}

export interface AuditTransport {
  send(request: HubRequest): Promise<HubResponse>;
}

/** No answer from Audit Hub: a timeout or a network failure. */
export class AuditTransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network',
    options?: ErrorOptions,
  ) {
    super(`Audit Hub unreachable: ${kind}`, options);
    this.name = 'AuditTransportError';
  }
}

export interface AuditLock {
  /** Runs `work` unless another instance holds `name`; answers whether it ran. */
  withLock(name: string, ttlMs: number, work: () => Promise<void>): Promise<boolean>;
}

export type ResponseActionResult = 'succeeded' | 'failed' | 'refused';

/** What the project does when Audit Hub asks; every one is optional. */
export interface AuditHandlers {
  /** The response actions the project runs, each in the webhook's transaction. */
  responseActions?: Partial<
    Record<ResponseAction, (tx: AuditTx, subject: string) => Promise<ResponseActionResult>>
  >;
  /** A user answered "it was not me": e.g. end their sessions, in the answer's transaction. */
  onNotMe?: (tx: AuditTx, userId: string) => Promise<void>;
  /** A new "Was it you?" prompt, after it is stored (and pushed, with the push module). */
  onSecurityPrompt?: (prompt: SecurityPrompt) => Promise<void>;
  /** The push of a prompt, in the project's words: English by default. */
  promptPush?: (prompt: SecurityPrompt) => Omit<PushMessage, 'url'>;
  /** An alert Audit Hub raised about this application. */
  onAlert?: (alert: z.infer<typeof AlertCreatedDataSchema>) => Promise<void>;
}
