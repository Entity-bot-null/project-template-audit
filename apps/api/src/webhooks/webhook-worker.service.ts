import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { WebhookReplySchema } from 'audit-contract';
import { signWebhook } from 'audit-contract/node';
import { createExternalHttpClient, ExternalServiceError } from '../common/http/external-http.js';
import { errorSummary } from '../common/logging/error-summary.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { env } from '../env/env.js';
import {
  observeWebhookOutbox,
  recordDependencyCall,
  recordWebhookDelivery,
  type WebhookOutcome,
} from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlockedAddressError } from './guarded-fetch.js';
import { WebhookOutboxService } from './webhook-outbox.service.js';
import { type ClaimedDelivery, WebhookStore, type WebhookOutboxStats } from './webhook.store.js';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_POLL_INTERVAL_MS,
  WEBHOOK_SHUTDOWN_GRACE_MS,
  WEBHOOK_STATS_INTERVAL_MS,
  WEBHOOK_SWEEP_INTERVAL_MS,
  WEBHOOK_TIMEOUT_MS,
  webhookRetryDelayMs,
} from './webhooks.constants.js';

/** Provider token of the fetch webhooks are sent with (guarded-fetch.ts). */
export const WEBHOOK_FETCH = Symbol('WEBHOOK_FETCH');

/** What an application answered to a delivery it verified. */
export type ReplyStatus = 'accepted' | 'refused' | 'unsupported';
export type ReplyListener = (delivery: ClaimedDelivery, status: ReplyStatus) => Promise<void>;

/** How an attempt ended, before it is recorded. */
interface Attempt {
  ok: boolean;
  /** The HTTP status, when there was an answer. */
  status: number | null;
  category: string;
  /** Not worth another attempt. */
  permanent: boolean;
  outcome?: WebhookOutcome;
  body?: unknown;
}

const RETRYABLE_STATUS = new Set([408, 425, 429]);

// Sends the webhook outbox (docs/adr/0013), as MailWorker sends the mail's: one
// worker per instance, one delivery at a time, claimed with a lease, signed
// when it is sent (the application's current and previous webhook secrets),
// the outcome recorded under the claim. Delivery is at least once: the
// application deduplicates by Audit-Webhook-Id.
@Injectable()
export class WebhookWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Webhooks');
  private readonly replyListeners = new Map<string, ReplyListener>();
  private readonly slugs = new Map<string, string>();
  private timers: NodeJS.Timeout[] = [];
  private draining: Promise<void> | undefined;
  private wakeRequested = false;
  private stopping = false;
  private stats: WebhookOutboxStats | undefined;

  constructor(
    private readonly store: WebhookStore,
    private readonly outbox: WebhookOutboxService,
    private readonly apps: ConnectedAppsService,
    private readonly prisma: PrismaService,
    @Inject(WEBHOOK_FETCH) private readonly fetch: typeof globalThis.fetch,
  ) {}

  onApplicationBootstrap(): void {
    this.outbox.onQueued(() => {
      this.wake();
    });
    observeWebhookOutbox(() => this.stats);
    this.timers = [
      setInterval(() => {
        this.wake();
      }, WEBHOOK_POLL_INTERVAL_MS).unref(),
      setInterval(() => void this.refreshStats(), WEBHOOK_STATS_INTERVAL_MS).unref(),
      setInterval(() => void this.sweep(), WEBHOOK_SWEEP_INTERVAL_MS).unref(),
    ];
    void this.refreshStats();
    this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.draining !== undefined) {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        this.draining,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, WEBHOOK_SHUTDOWN_GRACE_MS).unref();
        }),
      ]);
      clearTimeout(timeout);
    }
  }

  /** Called with the application's answer to every delivered webhook of `type`. */
  onReply(type: string, listener: ReplyListener): void {
    this.replyListeners.set(type, listener);
  }

  wake(): void {
    if (this.stopping) return;
    if (this.draining !== undefined) {
      this.wakeRequested = true;
      return;
    }
    this.startDrain();
  }

  /** Sends every due delivery now; resolves when none is left. */
  async runOnce(): Promise<void> {
    await this.idle();
    if (this.stopping) return;
    this.startDrain();
    await this.idle();
  }

  async idle(): Promise<void> {
    while (this.draining !== undefined) await this.draining;
  }

  private startDrain(): void {
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.wake();
      }
    });
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopping) {
        const claimed = await this.store.claim();
        if (claimed === undefined) return;
        await this.deliver(claimed);
      }
    } catch (error) {
      this.logger.warn(`Webhook worker paused: ${errorSummary(error)}`);
    }
  }

  private async deliver(claimed: ClaimedDelivery): Promise<void> {
    const slug = await this.slugOf(claimed.appId);
    const label = `${claimed.type} webhook ${claimed.id} to ${claimed.target} of ${slug} (attempt ${String(claimed.attempts)})`;
    if (claimed.attempts > WEBHOOK_MAX_ATTEMPTS) {
      await this.finish(claimed, slug, label, {
        ok: false,
        status: null,
        category: 'attempts_exhausted',
        permanent: true,
      });
      return;
    }
    if (claimed.expiresAt.getTime() <= Date.now()) {
      recordWebhookDelivery(slug, claimed.target, 'expired');
      await this.store.markExpired(claimed, 'expired');
      this.logger.warn(`Dropped ${label}: expired`);
      return;
    }
    let attempt: Attempt;
    try {
      attempt =
        claimed.target === 'app' ? await this.sendToApp(claimed) : await this.sendToChat(claimed);
    } catch (error) {
      // Something of ours failed (decrypting the secret, say): retried.
      this.logger.warn(`Could not send ${label}: ${errorSummary(error)}`);
      attempt = { ok: false, status: null, category: 'internal', permanent: false };
    }
    await this.finish(claimed, slug, label, attempt);
  }

  private async finish(claimed: ClaimedDelivery, slug: string, label: string, attempt: Attempt) {
    if (attempt.category === 'not_configured') {
      recordWebhookDelivery(slug, claimed.target, 'expired');
      await this.store.markExpired(claimed, 'not_configured');
      this.logger.warn(`Dropped ${label}: the destination is no longer configured`);
      return;
    }
    if (attempt.ok) {
      recordWebhookDelivery(slug, claimed.target, 'delivered');
      await this.store.markDelivered(claimed, attempt.status ?? 200);
      this.logger.log(`Delivered ${label}`);
      await this.reply(claimed, attempt.body);
      return;
    }
    if (attempt.permanent || claimed.attempts >= WEBHOOK_MAX_ATTEMPTS) {
      recordWebhookDelivery(slug, claimed.target, attempt.outcome ?? 'failed');
      await this.store.markFailed(claimed, attempt.status, attempt.category);
      this.logger.error(`Gave up on ${label}: ${attempt.category}`);
      return;
    }
    recordWebhookDelivery(slug, claimed.target, 'retry');
    const delayMs = webhookRetryDelayMs(claimed.attempts);
    await this.store.reschedule(claimed, delayMs, attempt.status, attempt.category);
    this.logger.warn(
      `Could not deliver ${label}: ${attempt.category}; retrying in ${String(Math.round(delayMs / 1000))} s`,
    );
  }

  private async reply(claimed: ClaimedDelivery, body: unknown): Promise<void> {
    if (claimed.target !== 'app') return;
    const listener = this.replyListeners.get(claimed.type);
    if (listener === undefined) return;
    const data = (body as { data?: unknown } | undefined)?.data;
    const parsed = WebhookReplySchema.safeParse(data);
    // A 2xx without the contract's answer: taken as accepted (it was delivered).
    const status: ReplyStatus = parsed.success ? parsed.data.status : 'accepted';
    try {
      await listener(claimed, status);
    } catch (error) {
      this.logger.warn(
        `Could not record the answer to ${claimed.type} webhook ${claimed.id}: ${errorSummary(error)}`,
      );
    }
  }

  /** Signed with the application's webhook secrets, through createExternalHttpClient. */
  private async sendToApp(claimed: ClaimedDelivery): Promise<Attempt> {
    const target =
      claimed.appId === null ? undefined : await this.apps.webhookTarget(claimed.appId);
    if (target === undefined) {
      return { ok: false, status: null, category: 'not_configured', permanent: true };
    }
    const url = new URL(target.url);
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      return { ok: false, status: null, category: 'insecure_url', permanent: true };
    }
    const headers = signWebhook({
      keys: target.keys,
      appSlug: target.slug,
      deliveryId: claimed.id,
      path: url.pathname,
      body: claimed.payload,
    });
    const { baseUrl, path, query } = splitUrl(url);
    const client = createExternalHttpClient({
      name: 'webhook',
      baseUrl,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      retries: 0,
      fetch: this.fetch,
    });
    try {
      const response = await client.request({
        method: 'POST',
        path,
        query,
        body: claimed.payload,
        headers,
      });
      return {
        ok: true,
        status: response.status,
        category: 'delivered',
        permanent: false,
        body: response.body,
      };
    } catch (error) {
      return classify(error);
    }
  }

  /**
   * A chat channel's incoming webhook. Not through createExternalHttpClient:
   * that client logs the request's path, and these URLs carry their secret in
   * the path. The same guarantees otherwise: a timeout, the dependency
   * metric, one log line (without the URL), the SSRF guard.
   */
  private async sendToChat(claimed: ClaimedDelivery): Promise<Attempt> {
    const url =
      claimed.target === 'slack' ? env.AUDIT_SLACK_WEBHOOK_URL : env.AUDIT_TEAMS_WEBHOOK_URL;
    if (url === undefined) {
      return { ok: false, status: null, category: 'not_configured', permanent: true };
    }
    const name = `webhook_${claimed.target}`;
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claimed.payload),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        redirect: 'error',
      });
      await response.body?.cancel();
      recordDependencyCall(
        name,
        response.ok ? 'success' : 'http_error',
        seconds(),
        response.status,
      );
      if (response.ok) {
        return { ok: true, status: response.status, category: 'delivered', permanent: false };
      }
      return classify(new ExternalServiceError(name, 'status', response.status));
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === 'TimeoutError';
      recordDependencyCall(name, timeout ? 'timeout' : 'network_error', seconds());
      return classify(
        error instanceof BlockedAddressError
          ? error
          : new ExternalServiceError(name, timeout ? 'timeout' : 'network', undefined, {
              cause: error,
            }),
      );
    }
  }

  private async slugOf(appId: string | null): Promise<string> {
    if (appId === null) return 'none';
    const known = this.slugs.get(appId);
    if (known !== undefined) return known;
    const row = await this.prisma.connectedApp.findUnique({
      where: { id: appId },
      select: { slug: true },
    });
    const slug = row?.slug ?? 'unknown';
    // Slugs never change: cached for the process's life.
    if (row !== null) this.slugs.set(appId, slug);
    return slug;
  }

  private async refreshStats(): Promise<void> {
    try {
      this.stats = await this.store.stats();
    } catch (error) {
      this.logger.warn(`Could not read the webhook queue: ${errorSummary(error)}`);
    }
  }

  private async sweep(): Promise<void> {
    try {
      const { deleted, expired } = await this.store.sweep();
      if (deleted + expired > 0) {
        this.logger.log(
          `Webhook retention: deleted ${String(deleted)} finished deliveries, dropped ${String(expired)} stale pending ones`,
        );
      }
    } catch (error) {
      this.logger.warn(`Webhook retention sweep failed: ${errorSummary(error)}`);
    }
  }
}

/** A failed attempt: retried, or given up on (a 401 at once: a secret mismatch is not transient). */
export function classify(error: unknown): Attempt {
  const cause = error instanceof ExternalServiceError ? error.cause : error;
  if (error instanceof BlockedAddressError || cause instanceof BlockedAddressError) {
    return { ok: false, status: null, category: 'blocked_address', permanent: true };
  }
  if (!(error instanceof ExternalServiceError)) {
    return { ok: false, status: null, category: 'network', permanent: false };
  }
  if (error.kind !== 'status' || error.status === undefined) {
    return { ok: false, status: null, category: error.kind, permanent: false };
  }
  const status = error.status;
  if (status === 401) {
    return {
      ok: false,
      status,
      category: 'unauthorized',
      permanent: true,
      outcome: 'unauthorized',
    };
  }
  if (status >= 500 || RETRYABLE_STATUS.has(status)) {
    return { ok: false, status, category: `http_${String(status)}`, permanent: false };
  }
  return { ok: false, status, category: `http_${String(status)}`, permanent: true };
}

/**
 * A URL as createExternalHttpClient takes it: the base up to the last "/", the
 * last segment as the path (the request goes to exactly the URL's path, which
 * the signature names) and the query as parameters.
 */
export function splitUrl(url: URL): {
  baseUrl: string;
  path: string;
  query: Record<string, string>;
} {
  const slash = url.pathname.lastIndexOf('/');
  return {
    baseUrl: `${url.origin}${url.pathname.slice(0, slash + 1)}`,
    path: url.pathname.slice(slash + 1),
    query: Object.fromEntries(url.searchParams),
  };
}
