import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppAccessService, type VisibleApps } from '../access/app-access.service.js';
import { mayUsePanel, PANEL_ACCESS_SELECT } from '../auth/panel-access.js';
import { errorSummary } from '../common/logging/error-summary.js';
import type { RequestUser } from '../common/types/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AlertRow, AlertsService } from './alerts.service.js';

/** How often the changes are read while someone listens. */
export const STREAM_POLL_MS = 2_000;
/**
 * How far back each read looks: a change made in a transaction that commits
 * later (the rules' batches last up to two minutes) still reaches everyone,
 * once (each instance remembers what it sent).
 */
export const STREAM_LOOKBACK_MS = 180_000;
const KEEPALIVE_MS = 25_000;
/** A stream ends after this: the browser reconnects at once, its access checked again. */
const MAX_STREAM_MS = 10 * 60_000;
const ACCESS_RECHECK_MS = 60_000;
export const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS = 500;
/** At most this many changes replayed after a reconnection; more: the browser reloads. */
const REPLAY_LIMIT = 200;
const BATCH = 500;
/**
 * The first read learns what changed before the first listener came, except
 * the last seconds: a change made while it connected is news, not the past.
 */
const PRIME_FRESH_MS = 10_000;
/** A slow reader whose unsent data passes this is dropped (it reconnects). */
const MAX_BUFFERED_BYTES = 1_000_000;

const ALERT_INCLUDE = { app: { select: { slug: true } } } as const;

interface Subscriber {
  id: number;
  user: RequestUser;
  apps: VisibleApps;
  checkedAt: number;
  res: Response;
}

/** A position in the stream: the last change's time and its alert. */
export function cursorOf(alert: { updatedAt: string; id: string }): string {
  return `${alert.updatedAt}|${alert.id}`;
}

/** The time a cursor names, or undefined when it is not one. */
export function cursorTime(cursor: string | undefined): Date | undefined {
  if (cursor === undefined) return undefined;
  const [at] = cursor.split('|');
  const time = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(time) ? undefined : new Date(time);
}

const sees = (apps: VisibleApps, appId: string) => apps === 'all' || apps.includes(appId);

// The live stream of alerts (Server-Sent Events, GET /api/alerts/stream):
// every change of an alert the listener may see, as the API answers it (ids,
// counts and titles: the same data as the list, nothing more), so the panel
// updates its counters and lists and sounds what is new without reloading.
// The database stays the only source of truth: each instance reads the
// changes every 2 seconds while someone listens (one indexed query for all
// its listeners), and a reconnection replays what changed since its last
// event (Last-Event-ID). Bounded: 5 streams per person and 500 per instance,
// 10 minutes each (the browser reconnects and is authenticated again), its
// access checked again every minute.
@Injectable()
export class AlertStreamService implements OnModuleDestroy {
  private readonly logger = new Logger('AlertStream');
  private readonly subscribers = new Map<number, Subscriber>();
  /** Each alert's last change sent, by its time: never the same twice. */
  private readonly sent = new Map<string, string>();
  private nextId = 1;
  private poller: NodeJS.Timeout | undefined;
  private keepalive: NodeJS.Timeout | undefined;
  private primed = false;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AppAccessService,
    private readonly alerts: AlertsService,
  ) {}

  onModuleDestroy(): void {
    for (const subscriber of this.subscribers.values()) this.end(subscriber, 'shutdown');
    this.stop();
  }

  /** Opens a stream on `res` for `user`, replaying the changes after `lastEventId` when given. */
  async open(user: RequestUser, res: Response, lastEventId: string | undefined): Promise<void> {
    if (this.subscribers.size >= MAX_STREAMS) {
      throw new HttpException(
        'Too many live streams on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const mine = [...this.subscribers.values()].filter((other) => other.user.id === user.id);
    if (mine.length >= MAX_STREAMS_PER_USER) {
      throw new HttpException(
        'Too many live streams for this account',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const apps = await this.access.visibleApps(user);
    const subscriber: Subscriber = { id: this.nextId++, user, apps, checkedAt: Date.now(), res };
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: no proxy compresses or buffers it (nginx: X-Accel-Buffering).
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    this.subscribers.set(subscriber.id, subscriber);
    res.on('close', () => {
      this.subscribers.delete(subscriber.id);
      if (this.subscribers.size === 0) this.stop();
    });
    setTimeout(() => {
      this.end(subscriber, 'renew');
    }, MAX_STREAM_MS).unref();

    const since = cursorTime(lastEventId);
    if (since !== undefined) await this.replay(subscriber, since);
    this.write(subscriber, 'ready', { at: new Date().toISOString() });
    this.start();
  }

  /** What changed since `since` (and a lookback before it), for one reconnected listener. */
  private async replay(subscriber: Subscriber, since: Date): Promise<void> {
    const rows = await this.prisma.alert.findMany({
      where: {
        updatedAt: { gt: new Date(since.getTime() - STREAM_LOOKBACK_MS) },
        ...(subscriber.apps === 'all' ? {} : { appId: { in: [...subscriber.apps] } }),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: REPLAY_LIMIT + 1,
      include: ALERT_INCLUDE,
    });
    if (rows.length > REPLAY_LIMIT) {
      this.write(subscriber, 'resync', { reason: 'too many changes since the last event' });
      return;
    }
    for (const alert of await this.alerts.responses(rows)) {
      this.write(subscriber, 'alert', { alert, replay: true }, cursorOf(alert));
    }
  }

  private start(): void {
    if (this.poller !== undefined) return;
    this.poller = setInterval(() => void this.poll(), STREAM_POLL_MS).unref();
    this.keepalive = setInterval(() => {
      for (const subscriber of this.subscribers.values()) this.raw(subscriber, ': keepalive\n\n');
    }, KEEPALIVE_MS).unref();
    void this.poll();
  }

  private stop(): void {
    if (this.poller !== undefined) clearInterval(this.poller);
    if (this.keepalive !== undefined) clearInterval(this.keepalive);
    this.poller = undefined;
    this.keepalive = undefined;
    // What changed while nobody listened is a replay (Last-Event-ID), not news.
    this.primed = false;
  }

  /** One read of the changes for every listener of this instance. */
  async poll(now: number = Date.now()): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      const rows = await this.prisma.alert.findMany({
        where: { updatedAt: { gt: new Date(now - STREAM_LOOKBACK_MS) } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        include: ALERT_INCLUDE,
      });
      let changed: AlertRow[] = rows.filter(
        (row) => this.sent.get(row.id) !== row.updatedAt.toISOString(),
      );
      if (!this.primed) {
        // The first read learns what was there: a listener hears what changes.
        this.primed = true;
        const past = changed.filter((row) => row.updatedAt.getTime() < now - PRIME_FRESH_MS);
        for (const row of past) this.sent.set(row.id, row.updatedAt.toISOString());
        changed = changed.filter((row) => row.updatedAt.getTime() >= now - PRIME_FRESH_MS);
        if (changed.length === 0) return 0;
      }
      for (const row of changed) this.sent.set(row.id, row.updatedAt.toISOString());
      this.forget(now);
      if (changed.length === 0) return 0;
      await this.recheckAccess(now);
      const answers = await this.alerts.responses(changed);
      for (const subscriber of this.subscribers.values()) {
        for (const alert of answers) {
          if (sees(subscriber.apps, alert.appId)) {
            this.write(subscriber, 'alert', { alert, replay: false }, cursorOf(alert));
          }
        }
      }
      return answers.length;
    } catch (error) {
      this.logger.warn(`Alert stream read failed: ${errorSummary(error)}`);
      return 0;
    } finally {
      this.polling = false;
    }
  }

  /** Forgets the changes older than the lookback: they are never read again. */
  private forget(now: number): void {
    const horizon = now - 2 * STREAM_LOOKBACK_MS;
    for (const [id, at] of this.sent) if (Date.parse(at) < horizon) this.sent.delete(id);
  }

  /** Every minute per listener: a person disabled, demoted or unassigned stops hearing at once. */
  private async recheckAccess(now: number): Promise<void> {
    for (const subscriber of this.subscribers.values()) {
      if (now - subscriber.checkedAt < ACCESS_RECHECK_MS) continue;
      subscriber.checkedAt = now;
      const user = await this.prisma.user.findUnique({
        where: { id: subscriber.user.id },
        select: { disabledAt: true, ...PANEL_ACCESS_SELECT },
      });
      if (user?.disabledAt !== null || user.role !== subscriber.user.role || !mayUsePanel(user)) {
        this.end(subscriber, 'access');
        continue;
      }
      subscriber.apps = await this.access.visibleApps(subscriber.user);
    }
  }

  private end(subscriber: Subscriber, reason: 'renew' | 'access' | 'shutdown'): void {
    if (!this.subscribers.has(subscriber.id)) return;
    this.write(subscriber, 'end', { reason });
    this.subscribers.delete(subscriber.id);
    subscriber.res.end();
  }

  private write(subscriber: Subscriber, event: string, data: unknown, id?: string): void {
    this.raw(
      subscriber,
      `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }

  private raw(subscriber: Subscriber, text: string): void {
    const { res } = subscriber;
    if (res.writableEnded || res.destroyed) return;
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      this.subscribers.delete(subscriber.id);
      res.destroy();
      return;
    }
    res.write(text);
  }

  /** Listeners on this instance (the gauge and the specs). */
  get size(): number {
    return this.subscribers.size;
  }
}
