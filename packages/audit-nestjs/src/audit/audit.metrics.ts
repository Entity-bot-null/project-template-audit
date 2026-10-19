import { type Counter, type Meter, metrics } from '@opentelemetry/api';

// The connector's metrics, next to the project's own (src/observability/
// metrics.ts): the same OpenTelemetry API, a no-op until telemetry is on.
// Instruments are created on first use, after the SDK registered its meter
// provider. Attributes are low-cardinality codes: never a user or a route.

const meter = () => metrics.getMeter('app');

function lazy<T>(create: () => T): () => T {
  let instrument: T | undefined;
  return () => (instrument ??= create());
}

export type EventOutcome = 'accepted' | 'duplicate' | 'rejected' | 'retry';
export type HubRequestKind = 'events' | 'catalog' | 'heartbeat' | 'activity' | 'erasure';
export type HubRequestOutcome =
  'ok' | 'rate_limited' | 'unavailable' | 'refused' | 'failed' | 'unreachable';

const events = lazy<Counter>(() =>
  meter().createCounter('app.audit.events', {
    description:
      'Queued events Audit Hub answered for, by outcome (retry: they wait for another try)',
  }),
);

const hubRequests = lazy<Counter>(() =>
  meter().createCounter('app.audit.hub.requests', {
    description: 'Requests to Audit Hub, by kind and outcome',
  }),
);

export function recordEvents(outcome: EventOutcome, count: number): void {
  if (count > 0) events().add(count, { outcome });
}

export function recordHubRequest(kind: HubRequestKind, outcome: HubRequestOutcome): void {
  hubRequests().add(1, { kind, outcome });
}

export interface QueueGaugeValues {
  waiting: number;
  oldestAgeSeconds: number;
}

const observed = new WeakSet<Meter>();

/**
 * The queue's size and the age of its oldest event, read from the forwarder's
 * last count. Once per meter (the meter provider registers them).
 */
export function observeQueue(
  read: () => QueueGaugeValues | undefined,
  meterOf: () => Meter = meter,
): void {
  const current = meterOf();
  if (observed.has(current)) return;
  observed.add(current);
  const waiting = current.createObservableGauge('app.audit.outbox.waiting', {
    description: 'Events queued for Audit Hub, sent or not yet',
  });
  const oldest = current.createObservableGauge('app.audit.outbox.oldest_age', {
    description: 'Age of the oldest event queued for Audit Hub',
    unit: 's',
  });
  waiting.addCallback((result) => {
    const values = read();
    if (values !== undefined) result.observe(values.waiting);
  });
  oldest.addCallback((result) => {
    const values = read();
    if (values !== undefined) result.observe(values.oldestAgeSeconds);
  });
}
