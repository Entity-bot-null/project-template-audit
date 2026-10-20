import type { Alert, AlertDetail } from '../audit/types';
import { eventSummary, SHOP } from './events';

// An alert as the API answers it (GET /api/alerts/:id), for the specs of the
// alerts list's drawer and of the alert's page.

export const ALERT_ID = '0190b6a1-0000-7000-8000-0000000000b1';
export const ALERT_EVENT_ID = '0190b6a1-0000-7000-8000-0000000000e1';

/** Many failed sign-ins of Ann Example, open, nobody on it yet. */
export function alertDetail(overrides: Partial<AlertDetail> = {}): AlertDetail {
  return {
    id: ALERT_ID,
    appId: SHOP,
    appSlug: 'shop',
    rule: 'brute_force',
    severity: 'high',
    status: 'open',
    subject: 'user-42',
    subjectLabel: 'Ann Example',
    title: 'Many failed sign-ins',
    occurrences: 1234,
    firstSeenAt: '2026-10-14T08:00:00.000Z',
    lastSeenAt: '2026-10-15T09:30:00.000Z',
    assigneeId: null,
    resolvedAt: null,
    resolvedById: null,
    acknowledgedAt: null,
    acknowledgedById: null,
    escalations: 0,
    lastEscalatedAt: null,
    mutedUntil: null,
    createdAt: '2026-10-14T08:00:00.000Z',
    updatedAt: '2026-10-15T09:30:00.000Z',
    version: 3,
    summary: { failures: 12, window: '10 minutes' },
    explanation: {
      looksFor: '10 or more failed sign-ins of one account within 15 minutes.',
      saw: ['12 failed sign-ins of Ann Example (user-42) within 15 minutes.'],
    },
    evidence: {
      events: 2,
      from: '2026-10-14T07:59:00.000Z',
      to: '2026-10-14T07:59:30.000Z',
      outcomes: [{ value: 'failure', count: 2 }],
      reasons: [
        { value: 'invalid_credentials', count: 1 },
        { value: 'mfa_failed', count: 1 },
      ],
      actions: [{ value: 'Signed in.', count: 2 }],
      accounts: 1,
      countries: [{ value: 'ES', count: 2 }],
      devices: [{ value: 'Microsoft Edge on Linux', count: 2 }],
    },
    assigneeLabel: null,
    resolvedByLabel: null,
    acknowledgedByLabel: null,
    activities: [
      {
        id: 'act-1',
        kind: 'opened',
        userId: null,
        userLabel: null,
        fromStatus: null,
        toStatus: null,
        note: null,
        assigneeLabel: null,
        createdAt: '2026-10-14T08:00:00.000Z',
      },
    ],
    events: [
      eventSummary({
        id: ALERT_EVENT_ID,
        eventId: 'evt-1',
        category: 'security',
        action: 'auth.sign_in',
        description: 'Signed in.',
        outcome: 'failure',
        recordedAt: '2026-10-14T07:59:00.000Z',
      }),
      eventSummary({
        id: 'not-a-uuid',
        eventId: 'evt-2',
        category: 'security',
        action: 'auth.sign_in_again',
        description: null,
        outcome: 'failure',
        recordedAt: '2026-10-14T07:59:30.000Z',
        actor: { type: 'user', id: null, role: null, label: null },
      }),
    ],
    ...overrides,
  };
}

/** An alert as the lists and the live stream send it: just opened, high, nobody on it. */
export function alertRow(overrides: Partial<Alert> = {}): Alert {
  const now = new Date().toISOString();
  return {
    id: ALERT_ID,
    appId: SHOP,
    appSlug: 'shop',
    rule: 'brute_force',
    severity: 'high',
    status: 'open',
    subject: 'user-42',
    subjectLabel: 'Ann Example',
    title: 'Many failed sign-ins',
    occurrences: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    assigneeId: null,
    resolvedAt: null,
    resolvedById: null,
    acknowledgedAt: null,
    acknowledgedById: null,
    escalations: 0,
    lastEscalatedAt: null,
    createdAt: now,
    mutedUntil: null,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

/** A live stream the spec feeds frame by frame (GET /api/alerts/stream). */
export function liveFeed() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  return {
    response: () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send(event: string, data: unknown, id?: string) {
      const head = id === undefined ? '' : `id: ${id}\n`;
      controller.enqueue(
        encoder.encode(`${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    },
    close() {
      controller.close();
    },
  };
}
