import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_INTERVAL_MS, SDK } from './audit.constants';
import { ClientEventBatchSchema, type ClientEventBatch } from './contract';
import { attachAuditSink, QUEUE_MAX, reportAudit } from './report';
import { blockedOriginOf, type SendOutcome, startAuditReporter } from './reporter';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

function setup(outcome: SendOutcome | (() => Promise<SendOutcome>) = 'sent') {
  const sent: { batch: ClientEventBatch; keepalive: boolean }[] = [];
  const state = { user: 'user-ana' as string | null };
  const stop = startAuditReporter({
    send: (batch, keepalive) => {
      sent.push({ batch: structuredClone(batch), keepalive });
      return typeof outcome === 'function' ? outcome() : Promise.resolve(outcome);
    },
    currentUser: () => state.user,
  });
  return { sent, state, stop };
}

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The page is hidden (and may be going away): the reporter sends what it has, with keepalive. */
async function pageHide() {
  visibility('hidden');
  await vi.waitFor(() => Promise.resolve());
}

function violation(effectiveDirective: string, blockedURI: string) {
  const event = new Event('securitypolicyviolation');
  Object.assign(event, { effectiveDirective, blockedURI });
  document.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  attachAuditSink(undefined);
  vi.useRealTimers();
});

describe('the SPA reporter', () => {
  it("sends the page's own events, from before it started too, as the contract has them", async () => {
    reportAudit('client.navigation.return_path_rejected');
    const { sent, stop } = setup();
    reportAudit('client.session.expired', undefined, 'user-ana');
    await pageHide();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.keepalive).toBe(true);
    expect(ClientEventBatchSchema.safeParse(sent[0]?.batch).success).toBe(true);
    expect(sent[0]?.batch.events.map((event) => event.action)).toEqual([
      'client.navigation.return_path_rejected',
      'client.session.expired',
    ]);
    expect(sent[0]?.batch.events[0]).toMatchObject({
      occurredAt: new Date(NOW).toISOString(),
      outcome: 'success',
      client: { type: 'web', sdk: { name: SDK.name, version: SDK.version } },
    });
    stop();
  });

  it('sends every 30 seconds, and when the page is hidden', async () => {
    const { sent, stop } = setup();
    reportAudit('client.navigation.return_path_rejected');
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.keepalive).toBe(false);

    reportAudit('client.navigation.return_path_rejected');
    visibility('visible');
    visibility('hidden');
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]?.keepalive).toBe(true);
    stop();
  });

  it('reports a CSP violation once a page, with its origin, never its path', async () => {
    const { sent, stop } = setup();
    violation('script-src-elem', 'https://evil.example/x.js?user=ana');
    violation('script-src-elem', 'https://evil.example/y.js');
    violation('style-src', 'inline');
    await pageHide();
    expect(sent[0]?.batch.events.map((event) => event.details)).toEqual([
      { directive: 'script-src-elem', blockedOrigin: 'https://evil.example' },
      { directive: 'style-src', blockedOrigin: 'inline' },
    ]);
    stop();
  });

  it('names where a blocked thing came from: an origin, a keyword, or other', () => {
    expect(blockedOriginOf('https://cdn.example:8443/a.js?q=1')).toBe('https://cdn.example:8443');
    expect(blockedOriginOf('eval')).toBe('eval');
    expect(blockedOriginOf('trusted-types-sink')).toBe('trusted-types-sink');
    expect(blockedOriginOf('not a url')).toBe('other');
    expect(blockedOriginOf('about:blank')).toBe('other');
  });

  it("keeps nothing signed out, and never sends one person's events with another's session", async () => {
    const { sent, state, stop } = setup();
    state.user = null;
    reportAudit('client.navigation.return_path_rejected'); // nobody to send it as: dropped
    reportAudit('client.session.expired', undefined, 'user-ana'); // waits for Ana
    await pageHide();
    expect(sent).toEqual([]);

    state.user = 'user-luis';
    reportAudit('client.navigation.return_path_rejected');
    await pageHide();
    expect(sent[0]?.batch.events.map((event) => event.action)).toEqual([
      'client.navigation.return_path_rejected',
    ]);
    expect(sent[0]?.batch.discardedAtSignOut).toBe(1);

    reportAudit('client.navigation.return_path_rejected');
    await pageHide();
    expect(sent[1]?.batch.discardedAtSignOut).toBeUndefined();
    stop();
  });

  it("sends an expired session's event when the same person signs in again", async () => {
    const { sent, state, stop } = setup();
    state.user = null;
    reportAudit('client.session.expired', undefined, 'user-ana');
    state.user = 'user-ana';
    await pageHide();
    expect(sent[0]?.batch.events.map((event) => event.action)).toEqual(['client.session.expired']);
    stop();
  });

  it('keeps the events when the API cannot take them now, and drops what it refuses', async () => {
    let outcome: SendOutcome = 'later';
    const { sent, stop } = setup(() => Promise.resolve(outcome));
    reportAudit('client.navigation.return_path_rejected');
    await pageHide();
    await pageHide();
    expect(sent.map((attempt) => attempt.batch.events.length)).toEqual([1, 1]);

    outcome = 'refused';
    await pageHide();
    await pageHide();
    expect(sent).toHaveLength(3);
    stop();
  });

  it('keeps the events when sending throws, sends one batch at a time, and keeps at most 20', async () => {
    let answer: (outcome: SendOutcome) => void = () => undefined;
    let fail = true;
    const { sent, stop } = setup(() =>
      fail
        ? Promise.reject(new Error('bug'))
        : new Promise<SendOutcome>((resolve) => {
            answer = resolve;
          }),
    );
    reportAudit('client.navigation.return_path_rejected');
    await pageHide();
    fail = false;
    visibility('hidden');
    visibility('hidden'); // still sending: no second request
    for (let index = 0; index < QUEUE_MAX + 5; index += 1) {
      reportAudit('client.navigation.return_path_rejected');
    }
    answer('sent');
    await vi.waitFor(() => Promise.resolve());
    await pageHide();
    expect(sent.map((attempt) => attempt.batch.events.length)).toEqual([1, 1, QUEUE_MAX]);
    stop();
  });

  it('stops listening when stopped, and its buffer keeps the newest 20 meanwhile', async () => {
    const { sent, stop } = setup();
    stop();
    for (let index = 0; index < QUEUE_MAX + 3; index += 1) {
      reportAudit('client.navigation.return_path_rejected', { n: String(index) });
    }
    await pageHide();
    expect(sent).toEqual([]);

    const again = setup();
    await pageHide();
    expect(again.sent[0]?.batch.events.map((event) => event.details?.n)).toEqual(
      Array.from({ length: QUEUE_MAX }, (_, index) => String(index + 3)),
    );
    again.stop();
  });
});
