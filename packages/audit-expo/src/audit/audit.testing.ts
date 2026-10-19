import { DatabaseSync } from 'node:sqlite';
import type {
  AuditLogger,
  AuditTransport,
  AuditTriggers,
  Device,
  DeviceFacts,
  DevicePosition,
  InstallationIdStore,
  SendResult,
  SqlDatabase,
} from './audit.ports';
import { type AuditClient, createAuditClient } from './audit-client';
import type {
  ActivityPage,
  AnsweredSecurityPrompt,
  ClientEventBatch,
  PromptAnswer,
  PushPlatform,
  RandomFill,
  SecurityPrompt,
} from './contract';
import { openAuditQueue } from './queue';

// Test doubles of the app's side, for the connector's specs and the app's
// own (a spec of a screen that records passes a real client over these).
// The queue runs its real SQL on Node's SQLite, which the specs have under
// Vitest and Jest alike; nothing here is ever bundled into the app.

/** An in-memory SQLite database with expo-sqlite's async calls. */
export function memoryDatabase(): SqlDatabase {
  const db = new DatabaseSync(':memory:');
  return {
    execAsync: (source) =>
      Promise.resolve().then(() => {
        db.exec(source);
      }),
    runAsync: (source, params) =>
      Promise.resolve().then(() => ({
        changes: Number(db.prepare(source).run(...params).changes),
      })),
    getAllAsync: <T>(source: string, params: (string | number | null)[]) =>
      Promise.resolve().then(() => db.prepare(source).all(...params) as T[]),
    getFirstAsync: <T>(source: string, params: (string | number | null)[]) =>
      Promise.resolve().then(() => (db.prepare(source).get(...params) ?? null) as T | null),
  };
}

/** Random bytes that are not random: each call counts up, so ids differ and tests repeat. */
export function countingRandom(): RandomFill {
  let next = 1;
  return (bytes) => {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (next + index) % 256;
    next += 1;
    return bytes;
  };
}

export const TEST_FACTS: DeviceFacts = {
  platform: 'android',
  appVersion: '1.4.2',
  appBuild: '42',
  updateId: null,
  os: 'Android',
  osVersion: '15',
  deviceModel: 'Pixel 9',
  locale: 'es-MX',
  timeZone: 'America/Mexico_City',
};

export function testDevice(facts: Partial<DeviceFacts> = {}, networkType = 'WIFI'): Device {
  return {
    facts: () => ({ ...TEST_FACTS, ...facts }),
    networkType: () => Promise.resolve(networkType),
  };
}

export function memoryInstallation(id: string | null = null): InstallationIdStore & {
  id: string | null;
} {
  const store = {
    id,
    get: () => Promise.resolve(store.id),
    set: (value: string) => {
      store.id = value;
      return Promise.resolve();
    },
  };
  return store;
}

/** The app's API, scripted: every batch is accepted unless `answer` says otherwise. */
export class FakeTransport implements AuditTransport {
  readonly batches: ClientEventBatch[] = [];
  readonly pushTokens = new Map<string, PushPlatform>();
  readonly unregistered: string[] = [];
  readonly answers: { id: string; answer: PromptAnswer }[] = [];
  readonly activityQueries: { cursor?: string; limit: number }[] = [];
  prompts: SecurityPrompt[] = [];
  pages: ActivityPage[] = [{ items: [] }];
  pushModule = true;
  answer: (batch: ClientEventBatch) => SendResult | Promise<SendResult> = (batch) => ({
    kind: 'answered',
    results: batch.events.map((event) => ({ eventId: event.eventId, status: 'accepted' })),
  });

  async sendEvents(batch: ClientEventBatch): Promise<SendResult> {
    this.batches.push(structuredClone(batch));
    return this.answer(batch);
  }

  activity(query: { cursor?: string; limit: number }): Promise<ActivityPage> {
    this.activityQueries.push(query);
    const index = query.cursor === undefined ? 0 : Number(query.cursor);
    const page = this.pages[index];
    if (page === undefined) return Promise.reject(new Error(`No page ${String(index)}`));
    return Promise.resolve(page);
  }

  securityPrompts(): Promise<SecurityPrompt[]> {
    return Promise.resolve(structuredClone(this.prompts));
  }

  answerPrompt(id: string, answer: PromptAnswer): Promise<AnsweredSecurityPrompt> {
    const prompt = this.prompts.find((candidate) => candidate.id === id);
    if (prompt === undefined) return Promise.reject(new Error('Not found'));
    this.answers.push({ id, answer });
    this.prompts = this.prompts.filter((candidate) => candidate.id !== id);
    return Promise.resolve({ ...prompt, answer });
  }

  registerPushToken(token: string, platform: PushPlatform): Promise<boolean> {
    if (this.pushModule) this.pushTokens.set(token, platform);
    return Promise.resolve(this.pushModule);
  }

  unregisterPushToken(token: string): Promise<void> {
    this.unregistered.push(token);
    this.pushTokens.delete(token);
    return Promise.resolve();
  }

  /** The events sent, by action, in order. */
  actions(): string[] {
    return this.batches.flatMap((batch) => batch.events.map((event) => event.action));
  }
}

/** The app's lifecycle, fired by hand. */
export class ManualTriggers implements AuditTriggers {
  private readonly listeners = { foreground: new Set<() => void>(), online: new Set<() => void>() };
  readonly intervals = new Map<number, () => void>();

  onForeground(listener: () => void): () => void {
    this.listeners.foreground.add(listener);
    return () => this.listeners.foreground.delete(listener);
  }

  onOnline(listener: () => void): () => void {
    this.listeners.online.add(listener);
    return () => this.listeners.online.delete(listener);
  }

  every(ms: number, task: () => void): () => void {
    this.intervals.set(ms, task);
    return () => this.intervals.delete(ms);
  }

  fire(what: 'foreground' | 'online'): void {
    for (const listener of this.listeners[what]) listener();
  }

  tick(ms: number): void {
    this.intervals.get(ms)?.();
  }

  get active(): number {
    return this.listeners.foreground.size + this.listeners.online.size + this.intervals.size;
  }
}

export class RecordingLogger implements AuditLogger {
  readonly lines: { level: 'info' | 'warn'; message: string; data?: object }[] = [];
  info(message: string, data?: Record<string, string | number | boolean>): void {
    this.lines.push({ level: 'info', message, data });
  }
  warn(message: string, data?: Record<string, string | number | boolean>): void {
    this.lines.push({ level: 'warn', message, data });
  }
  messages(level: 'info' | 'warn'): string[] {
    return this.lines.filter((line) => line.level === level).map((line) => line.message);
  }
}

export const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

/** A client over the doubles, its clock at NOW and signed in, for a spec to drive. */
export function testClient(
  options: {
    transport?: FakeTransport;
    database?: SqlDatabase;
    installation?: InstallationIdStore;
    device?: Device;
    /** What expo-location knows; an Error when it fails. */
    position?: DevicePosition | null | Error;
    consented?: boolean;
    /** The person also allowed the precise position. */
    precise?: boolean;
    /** A fresh fix (the provider's current()); absent: the provider has none. */
    current?: DevicePosition | null;
  } = {},
) {
  const clock = { now: NOW, signedIn: true };
  const transport = options.transport ?? new FakeTransport();
  const database = options.database ?? memoryDatabase();
  const queue = openAuditQueue(() => Promise.resolve(database));
  const triggers = new ManualTriggers();
  const logger = new RecordingLogger();
  const deadlines: (() => void)[] = [];
  const location =
    options.position === undefined
      ? undefined
      : {
          provider: {
            lastKnown: () =>
              options.position instanceof Error
                ? Promise.reject(options.position)
                : Promise.resolve(options.position ?? null),
            ...(options.current === undefined
              ? {}
              : { current: () => Promise.resolve(options.current ?? null) }),
          },
          consented: () => options.consented ?? true,
          // Read from the system as the app does: asynchronously.
          ...(options.precise === undefined
            ? {}
            : { precise: () => Promise.resolve(options.precise === true) }),
        };
  const client: AuditClient = createAuditClient({
    transport,
    queue,
    installation: options.installation ?? memoryInstallation('install-0001'),
    device: options.device ?? testDevice(),
    triggers,
    logger,
    random: countingRandom(),
    signedIn: () => clock.signedIn,
    ...(location === undefined ? {} : { location }),
    now: () => clock.now,
    // The sign-out's three seconds end when the spec says (expire()).
    wait: () => {
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      deadlines.push(release);
      return { done, cancel: release };
    },
  });
  return {
    client,
    transport,
    queue,
    database,
    triggers,
    logger,
    clock,
    /** The sign-out's deadline passes. */
    expire: () => {
      for (const release of deadlines.splice(0)) release();
    },
  };
}
