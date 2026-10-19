import type {
  ActivityPage,
  AnsweredSecurityPrompt,
  ClientEventBatch,
  ClientEventResult,
  PromptAnswer,
  PushPlatform,
  RandomFill,
  SecurityPrompt,
} from './contract';

// What the connector needs from the app, each implemented once by the app's
// own code (docs/adr/0009): the API through src/api (audit.ts), storage
// through src/lib/storage (auditQueue.ts), and the device through the Expo
// modules (audit.wiring.ts). The core never imports React Native or Expo.

/**
 * The part of expo-sqlite's SQLiteDatabase the queue uses: the app passes the
 * database it opened (src/lib/storage/auditQueue.ts).
 */
export type SqlValue = string | number | null;
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
}

/** What the API did with a batch of the device's events. */
export type SendResult =
  /** One result per event: accepted, duplicate or rejected. */
  | { kind: 'answered'; results: ClientEventResult[] }
  /** No answer at all (offline, a timeout, cancelled): tried again at the next chance. */
  | { kind: 'unreachable' }
  /**
   * Not now: the API failed or is busy (5xx, 429), or the session it was sent
   * with ended (401). Kept, and tried again later.
   */
  | { kind: 'later'; status: number; retryAfterMs?: number }
  /** The API refused the batch itself (another 4xx; 404 while its connector is off): dropped. */
  | { kind: 'refused'; status: number };

/** The routes the API's connector adds (docs/audit/connection-guide.md), through the app's api client. */
export interface AuditTransport {
  sendEvents(batch: ClientEventBatch): Promise<SendResult>;
  activity(query: { cursor?: string; limit: number }, signal?: AbortSignal): Promise<ActivityPage>;
  securityPrompts(signal?: AbortSignal): Promise<SecurityPrompt[]>;
  answerPrompt(id: string, answer: PromptAnswer): Promise<AnsweredSecurityPrompt>;
  /** False when the API has no push module (404): nothing to do. */
  registerPushToken(token: string, platform: PushPlatform): Promise<boolean>;
  unregisterPushToken(token: string): Promise<void>;
}

/** The installation's random id, in storage an uninstall wipes (persistentStorage). */
export interface InstallationIdStore {
  get(): Promise<string | null>;
  set(id: string): Promise<void>;
}

/** What the phone says about itself and the app, read when an event is recorded. */
export interface DeviceFacts {
  /** Platform.OS */
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  /** The OTA update running, if any (expo-updates). */
  updateId: string | null;
  os: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  locale: string | null;
  timeZone: string | null;
}

export interface Device {
  facts(): DeviceFacts;
  /** expo-network's type (WIFI, CELLULAR…), or null when unknown. */
  networkType(): Promise<string | null>;
}

export interface DevicePosition {
  latitude: number;
  longitude: number;
  /** Metres, as the system reports it; null when unknown. */
  accuracyM: number | null;
  /** Unix milliseconds. */
  capturedAt: number;
}

/**
 * Where the phone is, from expo-location. Null when there is none or the
 * permission is not granted; never a prompt.
 */
export interface LocationProvider {
  /** The last known position: the GPS never woken. */
  lastKnown(): Promise<DevicePosition | null>;
  /**
   * A fresh position (the GPS woken once, briefly): asked for at the start
   * of a session only, and only when the person allowed the precise position.
   * Without it, the last known one is used then too.
   */
  current?(): Promise<DevicePosition | null>;
}

/** The app's logger (src/lib/observability): never an event's contents, a token or a position. */
export interface AuditLogger {
  info(message: string, data?: Record<string, string | number | boolean>): void;
  warn(message: string, data?: Record<string, string | number | boolean>): void;
}

/** When the queue is sent besides the interval: the app's lifecycle (AppState, expo-network). */
export interface AuditTriggers {
  onForeground(listener: () => void): () => void;
  onOnline(listener: () => void): () => void;
  every(ms: number, task: () => void): () => void;
}

export interface AuditDependencies {
  transport: AuditTransport;
  queue: AuditQueue;
  installation: InstallationIdStore;
  device: Device;
  triggers: AuditTriggers;
  logger: AuditLogger;
  /** expo-crypto's getRandomValues: event ids and the installation id. */
  random: RandomFill;
  /** True only while the session is signed in: nothing is sent without one. */
  signedIn: () => boolean;
  /**
   * Location, only with the user's separate consent (src/store/preferences.ts).
   * `precise`: the person also allowed the precise position (Android's fine
   * location, iOS's full accuracy), read from the system when a position is
   * taken: kept to five decimals instead of 0.01°.
   */
  location?: {
    provider: LocationProvider;
    consented: () => boolean;
    precise?: () => boolean | Promise<boolean>;
  };
  now?: () => number;
  /** A timer of `ms`, ended early by cancel(): the sign-out's deadline. */
  wait?: (ms: number) => { done: Promise<void>; cancel: () => void };
}

/** One of the device's events, as the queue keeps it. */
export interface QueuedRow {
  eventId: string;
  userRef: string;
  occurredAt: string;
  payload: string;
  attempts: number;
}

/** The queue (queue.ts): one per app, its rows each of one user. */
export interface AuditQueue {
  add(row: Omit<QueuedRow, 'attempts'>): Promise<void>;
  /** The user's oldest rows first, at most `limit`. */
  next(userRef: string, limit: number): Promise<QueuedRow[]>;
  remove(eventIds: readonly string[]): Promise<void>;
  /** One more failed attempt each; answers the rows that reached `max`, which are removed. */
  failed(eventIds: readonly string[], max: number): Promise<number>;
  /** Removes every row not of `userRef` (null: every row); answers how many. */
  removeOthers(userRef: string | null): Promise<number>;
  /** Removes the user's rows; answers how many. */
  removeUser(userRef: string): Promise<number>;
  /** Keeps the newest `max` rows; answers how many older ones were dropped. */
  trim(max: number): Promise<number>;
  meta(key: MetaKey): Promise<string | null>;
  setMeta(key: MetaKey, value: string | null): Promise<void>;
}

/** What the queue remembers besides rows: whose it is, what it dropped, the push token sent. */
export type MetaKey = 'user' | 'discarded' | 'push_token';
