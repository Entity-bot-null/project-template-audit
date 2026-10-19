import { randomUUID } from 'node:crypto';
import type { AuditConfig } from './audit-env.js';
import type {
  AuditLock,
  AuditPushSender,
  AuditStore,
  AuditTransport,
  HubRequest,
  HubResponse,
  NewSecurityPrompt,
  PromptAnswer,
  PushMessage,
  PushPlatform,
  QueuedEvent,
  QueueStats,
  SecurityPrompt,
  SequenceState,
} from './audit.ports.js';
import type { Actions } from './catalog/catalog.js';
import type { AuditEventDraft } from './contract/index.js';
import type { AuditTx } from './host.js';

// Test doubles of the ports, for the connector's specs here and in every
// connected project (they run under its Vitest as its own code). No mocking
// library: plain objects with the ports' behavior, in memory.

/**
 * Actions of a made-up project, for the specs of what takes a catalog
 * (changeOf, buildEvent): a sensitive and a personal change field, details,
 * an action both sides may send. A connected project's own actions are its
 * business; the specs never assume them.
 */
export const TEST_ACTIONS: Actions = {
  'shop.order.placed': {
    category: 'audit',
    severity: 'info',
    description: 'A customer placed an order.',
    source: 'server',
    resourceType: 'order',
    details: { fields: { total: { type: 'number', min: 0 } } },
    change: {
      fields: {
        status: { type: 'enum', values: ['draft', 'placed'] },
        cardNumber: { type: 'string', sensitive: true },
        note: { type: 'string', maxLength: 200, personal: true },
      },
    },
  },
  'shop.cart.viewed': {
    category: 'audit',
    severity: 'info',
    description: 'A customer opened their cart.',
    source: 'both',
    details: { fields: { items: { type: 'integer', min: 0 } } },
  },
};

/** A transaction token: the memory store needs nothing more. */
export const TEST_TX = { __auditTx: true } as unknown as AuditTx;

export const TEST_CONFIG: AuditConfig = {
  hubUrl: 'https://audit.example.test',
  app: 'shop',
  keyId: '0199e0b1-0000-7000-8000-0000000000a1',
  keySecret: Buffer.alloc(32, 1).toString('base64url'),
  pseudonymKey: Buffer.alloc(32, 2).toString('base64url'),
  webhookSecrets: [Buffer.alloc(32, 3).toString('base64url')],
  responseActions: ['revoke_sessions'],
  queueAlert: 100,
  appVersion: '1.2.3',
  push: null,
};

/** TEST_CONFIG with the push module on. */
export const TEST_PUSH_CONFIG: AuditConfig = {
  ...TEST_CONFIG,
  push: { provider: 'expo', accessToken: undefined },
};

interface Row {
  id: string;
  eventId: string;
  sourceSeq: number | null;
  draft: AuditEventDraft;
  attempts: number;
  nextAttemptAt: number;
  lockedUntil: number | null;
  lastError: string | null;
  createdAt: number;
}

/** The connector's tables, in memory; `transaction` rolls back what its work did when it throws. */
export class MemoryStore implements AuditStore {
  rows: Row[] = [];
  counter: SequenceState | null = null;
  receipts = new Map<string, string>();
  prompts: (SecurityPrompt & { webhookId: string })[] = [];
  /** Users the store knows: a prompt for anyone else is not stored (the foreign key). */
  users = new Set<string>(['user-1']);
  now = () => Date.now();
  private created = 0;

  async transaction<T>(work: (tx: AuditTx) => Promise<T>): Promise<T> {
    const saved = {
      rows: structuredClone(this.rows),
      counter: structuredClone(this.counter),
      receipts: new Map(this.receipts),
      prompts: structuredClone(this.prompts),
    };
    try {
      return await work(TEST_TX);
    } catch (error) {
      Object.assign(this, saved);
      throw error;
    }
  }

  async enqueue(_tx: AuditTx, drafts: readonly AuditEventDraft[]): Promise<void> {
    await Promise.resolve();
    for (const draft of drafts) this.add(draft);
  }

  async enqueueAlone(drafts: readonly AuditEventDraft[]): Promise<Set<string>> {
    await Promise.resolve();
    const queued = new Set<string>();
    for (const draft of drafts) {
      if (this.rows.some((row) => row.eventId === draft.eventId)) continue;
      this.add(draft);
      queued.add(draft.eventId);
    }
    return queued;
  }

  private add(draft: AuditEventDraft): void {
    this.created += 1;
    this.rows.push({
      id: `row-${String(this.created).padStart(6, '0')}`,
      eventId: draft.eventId,
      sourceSeq: null,
      draft: structuredClone(draft),
      attempts: 0,
      nextAttemptAt: 0,
      lockedUntil: null,
      lastError: null,
      createdAt: this.now(),
    });
  }

  async sequence(limit: number): Promise<SequenceState> {
    const state = await this.state();
    const fresh = this.rows.filter((row) => row.sourceSeq === null).slice(0, limit);
    for (const row of fresh) {
      state.lastSeq += 1;
      row.sourceSeq = state.lastSeq;
    }
    return { ...state };
  }

  async state(): Promise<SequenceState> {
    await Promise.resolve();
    this.counter ??= { epoch: randomUUID(), lastSeq: 0 };
    return this.counter;
  }

  async claimDue(limit: number, now: Date, leaseMs: number): Promise<QueuedEvent[]> {
    await Promise.resolve();
    const due = this.rows
      .filter(
        (row): row is Row & { sourceSeq: number } =>
          row.sourceSeq !== null &&
          row.nextAttemptAt <= now.getTime() &&
          (row.lockedUntil === null || row.lockedUntil < now.getTime()),
      )
      .sort((a, b) => a.sourceSeq - b.sourceSeq)
      .slice(0, limit);
    for (const row of due) row.lockedUntil = now.getTime() + leaseMs;
    return due.map((row) => ({
      id: row.id,
      sourceSeq: row.sourceSeq,
      attempts: row.attempts,
      draft: structuredClone(row.draft),
    }));
  }

  async remove(ids: readonly string[]): Promise<void> {
    await Promise.resolve();
    this.rows = this.rows.filter((row) => !ids.includes(row.id));
  }

  async retryLater(
    ids: readonly string[],
    at: Date,
    error: string,
    failed: boolean,
  ): Promise<void> {
    await Promise.resolve();
    for (const row of this.rows.filter((candidate) => ids.includes(candidate.id))) {
      row.nextAttemptAt = at.getTime();
      row.lockedUntil = null;
      row.lastError = error;
      if (failed) row.attempts += 1;
    }
  }

  async stats(now: Date): Promise<QueueStats> {
    await Promise.resolve();
    const oldest = Math.min(...this.rows.map((row) => row.createdAt));
    return {
      size: this.rows.length,
      oldestAgeSeconds:
        this.rows.length === 0 ? 0 : Math.max(0, Math.floor((now.getTime() - oldest) / 1000)),
      retrying: this.rows.filter((row) => row.attempts > 0).length,
    };
  }

  async firstReceipt(_tx: AuditTx, id: string, type: string): Promise<boolean> {
    await Promise.resolve();
    if (this.receipts.has(id)) return false;
    this.receipts.set(id, type);
    return true;
  }

  async forgetReceipts(_before: Date): Promise<number> {
    await Promise.resolve();
    return 0;
  }

  async savePrompt(_tx: AuditTx, prompt: NewSecurityPrompt): Promise<SecurityPrompt | null> {
    await Promise.resolve();
    if (!this.users.has(prompt.userId)) return null;
    if (this.prompts.some((existing) => existing.webhookId === prompt.webhookId)) return null;
    const saved = {
      ...prompt,
      id: randomUUID(),
      answer: null,
      answeredAt: null,
      createdAt: new Date(this.now()),
    };
    this.prompts.push(saved);
    return saved;
  }

  async openPrompts(userId: string, now: Date): Promise<SecurityPrompt[]> {
    await Promise.resolve();
    return this.prompts.filter(
      (prompt) => prompt.userId === userId && prompt.answer === null && prompt.expiresAt > now,
    );
  }

  async answerPrompt(
    _tx: AuditTx,
    userId: string,
    id: string,
    answer: PromptAnswer,
    now: Date,
  ): Promise<SecurityPrompt | null> {
    await Promise.resolve();
    const prompt = this.prompts.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.answer === null &&
        candidate.expiresAt > now,
    );
    if (prompt === undefined) return null;
    prompt.answer = answer;
    prompt.answeredAt = now;
    return prompt;
  }

  async forgetPrompts(_before: Date): Promise<number> {
    await Promise.resolve();
    return 0;
  }

  /** Push tokens: token → its user and platform. */
  pushTokens = new Map<string, { userId: string; platform: PushPlatform }>();

  async savePushToken(userId: string, token: string, platform: PushPlatform): Promise<void> {
    await Promise.resolve();
    this.pushTokens.set(token, { userId, platform });
  }

  async deletePushToken(userId: string, token: string): Promise<boolean> {
    await Promise.resolve();
    if (this.pushTokens.get(token)?.userId !== userId) return false;
    return this.pushTokens.delete(token);
  }

  async pushTokensOf(userId: string): Promise<string[]> {
    await Promise.resolve();
    return [...this.pushTokens].filter(([, owner]) => owner.userId === userId).map(([t]) => t);
  }

  async forgetPushTokens(tokens: readonly string[]): Promise<number> {
    await Promise.resolve();
    return tokens.filter((token) => this.pushTokens.delete(token)).length;
  }
}

/** Expo's push service as a function of the push; every push kept. */
export class FakePushSender implements AuditPushSender {
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  constructor(
    public respond: (tokens: readonly string[]) => { unregistered: string[] } = () => ({
      unregistered: [],
    }),
  ) {}

  async send(tokens: readonly string[], message: PushMessage): Promise<{ unregistered: string[] }> {
    await Promise.resolve();
    this.sent.push({ tokens: [...tokens], message });
    return this.respond(tokens);
  }
}

/** Audit Hub as a function of the request; every request kept. */
export class FakeTransport implements AuditTransport {
  readonly requests: HubRequest[] = [];
  constructor(public respond: (request: HubRequest) => HubResponse | Promise<HubResponse>) {}

  async send(request: HubRequest): Promise<HubResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

/** A lock held by another instance when `busy`. */
export class FakeLock implements AuditLock {
  busy = false;
  async withLock(_name: string, _ttlMs: number, work: () => Promise<void>): Promise<boolean> {
    if (this.busy) return false;
    await work();
    return true;
  }
}

/** Audit Hub's success envelope. */
export const ok = (data: unknown): HubResponse => ({
  status: 200,
  body: { data, message: 'Operation successful' },
});
