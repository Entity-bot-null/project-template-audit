import { FLUSH_INTERVAL_MS, SDK } from './audit.constants';
// Types only from the contract's index, and uuidv7 from its own module: the
// chunk gets no schema of the contract (and no Zod), only what it runs.
import type { ClientEvent, ClientEventBatch, RandomFill } from './contract';
import { uuidv7 } from './contract/uuidv7';
import { attachAuditSink, QUEUE_MAX, type Reported } from './report';

// The SPA's side of Audit Hub (docs/audit/connection-guide.md#the-web-app):
// a lazy chunk, loaded after the first render and only when the API's
// connector takes the browser's events. It queues the page's own events in
// memory, per user, and sends them through the app's api client every 30 s
// and when the page is hidden (keepalive: it may be going away). One
// person's events are never sent with another's session: they are dropped,
// and the next batch says how many. Kept small: it counts in the template's
// total JavaScript budget.

/** What became of a batch: the API answered for it, it may go later (offline, 401, 429, 5xx), or it was refused. */
export type SendOutcome = 'sent' | 'later' | 'refused';

export interface ReporterDependencies {
  /** POST /api/audit/client-events through the app's api client; `keepalive` as the page hides. */
  send(batch: ClientEventBatch, keepalive: boolean): Promise<SendOutcome>;
  /** The signed-in user's id; null when anonymous. */
  currentUser(): string | null;
  /** crypto.getRandomValues by default. */
  random?: RandomFill;
}

/** Where a blocked thing came from: an origin, or CSP's keyword (inline, eval…), never a path or a query. */
export function blockedOriginOf(uri: string): string {
  try {
    const { origin } = new URL(uri);
    if (origin !== 'null') return origin;
  } catch {
    if (/^[a-z-]{1,32}$/.test(uri)) return uri;
  }
  return 'other';
}

/** An event, and whose it is. */
type Queued = [userRef: string, event: ClientEvent];

/** Starts the reporter; answers the stop. */
export function startAuditReporter(deps: ReporterDependencies): () => void {
  // uuidv7 fills a new Uint8Array(16): an ArrayBuffer, as Web Crypto asks.
  const random: RandomFill =
    deps.random ?? ((bytes) => crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>));
  let queue: Queued[] = [];
  let discarded = 0;
  let sending = false;
  const violations = new Set<string>();

  function take(reported: Reported): void {
    const userRef = reported.userRef ?? deps.currentUser();
    // Signed out: nothing could send it.
    if (userRef === null) return;
    if (
      queue.push([
        userRef,
        {
          eventId: uuidv7(random, reported.at),
          occurredAt: new Date(reported.at).toISOString(),
          action: reported.action,
          outcome: 'success',
          client: { type: 'web', sdk: SDK },
          details: reported.details,
        },
      ]) > QUEUE_MAX
    ) {
      queue.shift();
    }
  }

  async function flush(keepalive: boolean): Promise<void> {
    const user = deps.currentUser();
    if (sending || user === null) return;
    const mine = queue.filter(([userRef]) => userRef === user);
    discarded += queue.length - mine.length;
    queue = mine;
    if (mine.length === 0) return;
    // A copy: what is recorded while it is sent waits for the next flush.
    const batch = [...mine];
    const reported = discarded;
    sending = true;
    try {
      const outcome = await deps.send(
        {
          events: batch.map(([, event]) => event),
          ...(reported > 0 ? { discardedAtSignOut: reported } : {}),
        },
        keepalive,
      );
      if (outcome !== 'later') queue = queue.filter((queued) => !batch.includes(queued));
      if (outcome === 'sent') discarded -= reported;
    } catch {
      // Kept for the next flush.
    } finally {
      sending = false;
    }
  }

  const onViolation = ({ effectiveDirective, blockedURI }: SecurityPolicyViolationEvent) => {
    const directive = effectiveDirective.slice(0, 64);
    const blockedOrigin = blockedOriginOf(blockedURI);
    const key = `${directive} ${blockedOrigin}`;
    // Once a page: a blocked script on every render is one finding.
    if (violations.has(key)) return;
    violations.add(key);
    take({
      action: 'client.security.csp_violation',
      details: { directive, blockedOrigin },
      at: Date.now(),
    });
  };
  // The last moment a page is sure to get, closing or not (pagehide is not).
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flush(true);
  };

  attachAuditSink(take);
  document.addEventListener('securitypolicyviolation', onViolation);
  document.addEventListener('visibilitychange', onHidden);
  const timer = setInterval(() => void flush(false), FLUSH_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    document.removeEventListener('securitypolicyviolation', onViolation);
    document.removeEventListener('visibilitychange', onHidden);
    attachAuditSink(undefined);
  };
}
