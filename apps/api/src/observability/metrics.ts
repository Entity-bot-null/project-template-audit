import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
  type ObservableGauge,
} from '@opentelemetry/api';

// The application's own metrics, next to the ones the instrumentations record
// (HTTP server and client, database, runtime: docs/observability.md#metrics).
// Written against the OpenTelemetry API, which is a no-op until the SDK is
// started: with telemetry off (the default) recording costs a function call.
//
// Instruments are created on first use, not at import: the SDK registers its
// meter provider at boot, and an instrument created before that would stay a
// no-op forever.

const meter = () => metrics.getMeter('app');

function lazy<T>(create: () => T): () => T {
  let instrument: T | undefined;
  return () => (instrument ??= create());
}

/** Seconds, the unit of every duration histogram (OpenTelemetry semantic conventions). */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

const serverErrors = lazy<Counter>(() =>
  meter().createCounter('app.server.errors', {
    description: 'Responses with a 5xx status, by where the failure came from',
  }),
);

const dependencyDuration = lazy<Histogram>(() =>
  meter().createHistogram('app.dependency.duration', {
    description: 'Calls to external services through the shared HTTP client, retries included',
    unit: 's',
    advice: { explicitBucketBoundaries: DURATION_BUCKETS },
  }),
);

const cacheOperations = lazy<Counter>(() =>
  meter().createCounter('app.cache.operations', {
    description: 'Cache reads by result (hit, miss, error)',
  }),
);

const degradations = lazy<Counter>(() =>
  meter().createCounter('app.degraded.operations', {
    description: 'Operations served by a fallback because an optional dependency was unavailable',
  }),
);

const slowQueries = lazy<Counter>(() =>
  meter().createCounter('app.db.slow_queries', {
    description: 'Database queries slower than DB_SLOW_QUERY_MS',
  }),
);

// Email (docs/architecture.md#email). Attributes are the message kind and the
// outcome: never an address, a user or a message id.
const mailDeliveries = lazy<Counter>(() =>
  meter().createCounter('app.mail.deliveries', {
    description: 'Delivery attempts of outbox messages, by outcome (sent, retry, failed, expired)',
  }),
);

const mailDeliveryDuration = lazy<Histogram>(() =>
  meter().createHistogram('app.mail.delivery.duration', {
    description: 'Time the SMTP server took to accept or refuse one message',
    unit: 's',
    advice: { explicitBucketBoundaries: DURATION_BUCKETS },
  }),
);

const mailLatency = lazy<Histogram>(() =>
  meter().createHistogram('app.mail.latency', {
    description: 'Time from queueing a message to the SMTP server accepting it, retries included',
    unit: 's',
    advice: { explicitBucketBoundaries: [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200] },
  }),
);

const mailSuppressed = lazy<Counter>(() =>
  meter().createCounter('app.mail.suppressed', {
    description: 'Messages not queued because their address reached its per-address limit',
  }),
);

/** The queue's numbers, as the worker last read them (undefined until then). */
export interface MailOutboxGaugeValues {
  waiting: number;
  oldestAgeSeconds: number;
}

let mailOutboxValues: (() => MailOutboxGaugeValues | undefined) | undefined;

// Gauges read the worker's last reading (every 30 s), never the database on
// the export path.
const mailOutboxGauges = lazy<[ObservableGauge, ObservableGauge]>(() => {
  const waiting = meter().createObservableGauge('app.mail.outbox.waiting', {
    description: 'Outbox messages still to send (pending, or being sent)',
  });
  const oldest = meter().createObservableGauge('app.mail.outbox.oldest_age', {
    description: 'Age of the oldest outbox message still to send',
    unit: 's',
  });
  meter().addBatchObservableCallback(
    (result) => {
      const values = mailOutboxValues?.();
      if (values === undefined) return;
      result.observe(waiting, values.waiting);
      result.observe(oldest, values.oldestAgeSeconds);
    },
    [waiting, oldest],
  );
  return [waiting, oldest];
});

// Audit Hub's ingestion (docs/design/audit-hub). connected_app is the
// application's slug, bounded by the number of registered applications:
// never a user, an IP, a key or an event id.
const ingestRequests = lazy<Counter>(() =>
  meter().createCounter('app.ingest.requests', {
    description: 'Signed requests to the ingestion and connector APIs, by endpoint and outcome',
  }),
);

const ingestEvents = lazy<Counter>(() =>
  meter().createCounter('app.ingest.events', {
    description: 'Events received, by result (accepted, duplicate, rejected) and rejection reason',
  }),
);

const ingestBatchEvents = lazy<Histogram>(() =>
  meter().createHistogram('app.ingest.batch.events', {
    description: 'Events per ingestion batch',
    unit: '{event}',
    advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100] },
  }),
);

/** One connected application, as the monitor last read it (every 30 s). */
export interface ConnectedAppGaugeValues {
  slug: string;
  /** Undefined until the application sent its first heartbeat. */
  heartbeatAgeSeconds: number | undefined;
  queueSize: number;
  queueOldestAgeSeconds: number;
  /** Sequence numbers missing for longer than the grace period. */
  sequenceGapEvents: number;
}

let connectedAppValues: (() => readonly ConnectedAppGaugeValues[] | undefined) | undefined;

const connectedAppGauges = lazy(() => {
  const heartbeatAge = meter().createObservableGauge('app.connected_app.heartbeat_age', {
    description: 'Time since the application last sent a heartbeat',
    unit: 's',
  });
  const queueSize = meter().createObservableGauge('app.connected_app.queue_size', {
    description: "Events waiting in the application's connector queue, from its heartbeats",
    unit: '{event}',
  });
  const queueOldest = meter().createObservableGauge('app.connected_app.queue_oldest_age', {
    description: "Age of the oldest event in the application's connector queue",
    unit: 's',
  });
  const gapEvents = meter().createObservableGauge('app.ingest.sequence_gap_events', {
    description: 'Sequence numbers of the application missing for longer than the grace period',
    unit: '{event}',
  });
  meter().addBatchObservableCallback(
    (result) => {
      for (const app of connectedAppValues?.() ?? []) {
        const attributes = { connected_app: app.slug };
        if (app.heartbeatAgeSeconds !== undefined) {
          result.observe(heartbeatAge, app.heartbeatAgeSeconds, attributes);
        }
        result.observe(queueSize, app.queueSize, attributes);
        result.observe(queueOldest, app.queueOldestAgeSeconds, attributes);
        result.observe(gapEvents, app.sequenceGapEvents, attributes);
      }
    },
    [heartbeatAge, queueSize, queueOldest, gapEvents],
  );
  return [heartbeatAge, queueSize, queueOldest, gapEvents];
});

// Integrity and retention (docs/adr/0007, docs/adr/0008).
const integrityChecks = lazy<Counter>(() =>
  meter().createCounter('app.integrity.checks', {
    description: 'Integrity verifications, by outcome (passed, failed)',
  }),
);

/** One application's sealing state, as the sealer last read it. */
export interface StreamGaugeValues {
  slug: string;
  /** Age of its oldest event not yet in a seal; 0 when everything is sealed. */
  unsealedAgeSeconds: number;
}

let integrityValues: (() => readonly StreamGaugeValues[] | undefined) | undefined;
let jobValues: (() => ReadonlyMap<string, number> | undefined) | undefined;
let privilegesValue: (() => boolean | undefined) | undefined;

const integrityGauges = lazy(() => {
  const unsealed = meter().createObservableGauge('app.integrity.unsealed_age', {
    description: 'Age of the oldest event of the application not yet sealed',
    unit: 's',
  });
  unsealed.addCallback((result) => {
    for (const app of integrityValues?.() ?? []) {
      result.observe(app.unsealedAgeSeconds, { connected_app: app.slug });
    }
  });
  return unsealed;
});

const jobGauges = lazy(() => {
  const lastSuccess = meter().createObservableGauge('app.job.last_success_timestamp', {
    description: 'Unix time of the last successful run of a daily job (retention, integrity)',
    unit: 's',
  });
  lastSuccess.addCallback((result) => {
    for (const [job, seconds] of jobValues?.() ?? new Map<string, number>()) {
      result.observe(seconds, { job_name: job });
    }
  });
  return lastSuccess;
});

const privilegesGauge = lazy(() => {
  const gauge = meter().createObservableGauge('app.database.privileges_ok', {
    description:
      "1 when the API's database role cannot update or delete audit records, 0 when it can",
  });
  gauge.addCallback((result) => {
    const ok = privilegesValue?.();
    if (ok !== undefined) result.observe(ok ? 1 : 0);
  });
  return gauge;
});

// Audit Hub's alerts, webhooks, rules and enrichment (F4). connected_app is
// the slug; target is app, slack or teams; severity is the alert's.
const webhookDeliveries = lazy<Counter>(() =>
  meter().createCounter('app.webhook.deliveries', {
    description:
      'Webhook delivery attempts, by application, target and outcome (delivered, retry, failed, unauthorized, expired, refused)',
  }),
);

/** The webhook queue's numbers, as the worker last read them. */
export interface WebhookOutboxGaugeValues {
  waiting: number;
  oldestAgeSeconds: number;
}

let webhookOutboxValues: (() => WebhookOutboxGaugeValues | undefined) | undefined;
let openAlertValues: (() => ReadonlyMap<string, number> | undefined) | undefined;
let rulesLagValue: (() => number | undefined) | undefined;
let geoIpAgeValue: (() => number | undefined) | undefined;

const webhookOutboxGauges = lazy<[ObservableGauge, ObservableGauge]>(() => {
  const waiting = meter().createObservableGauge('app.webhook.outbox.waiting', {
    description: 'Webhook deliveries still to send (pending, or being sent)',
  });
  const oldest = meter().createObservableGauge('app.webhook.outbox.oldest_age', {
    description: 'Age of the oldest webhook delivery still to send',
    unit: 's',
  });
  meter().addBatchObservableCallback(
    (result) => {
      const values = webhookOutboxValues?.();
      if (values === undefined) return;
      result.observe(waiting, values.waiting);
      result.observe(oldest, values.oldestAgeSeconds);
    },
    [waiting, oldest],
  );
  return [waiting, oldest];
});

const openAlertsGauge = lazy(() => {
  const gauge = meter().createObservableGauge('app.alerts.open', {
    description: 'Security alerts open or in review, by severity',
  });
  gauge.addCallback((result) => {
    for (const [severity, count] of openAlertValues?.() ?? new Map<string, number>()) {
      result.observe(count, { severity });
    }
  });
  return gauge;
});

const rulesLagGauge = lazy(() => {
  const gauge = meter().createObservableGauge('app.rules.cursor_lag', {
    description: 'How far the real-time rules are behind the newest event they may read',
    unit: 's',
  });
  gauge.addCallback((result) => {
    const lag = rulesLagValue?.();
    if (lag !== undefined) result.observe(lag);
  });
  return gauge;
});

const geoIpAgeGauge = lazy(() => {
  const gauge = meter().createObservableGauge('app.geoip.database_age', {
    description: 'Days since the oldest loaded IP geolocation database was built',
    unit: 'd',
  });
  gauge.addCallback((result) => {
    const days = geoIpAgeValue?.();
    if (days !== undefined) result.observe(days);
  });
  return gauge;
});

// Web Vitals the web app reports (telemetry/web-vitals.ts). The buckets hold
// every rating threshold of web.dev, so the share of good page loads and the
// p75 compared with a threshold are exact.
const webVitalDuration = lazy<Histogram>(() =>
  meter().createHistogram('app.web_vitals.duration', {
    description: 'Web Vitals of page loads measured in the browser: LCP, INP, FCP, TTFB',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.05, 0.1, 0.2, 0.5, 0.8, 1, 1.8, 2.5, 3, 4, 6, 10],
    },
  }),
);

const webVitalLayoutShift = lazy<Histogram>(() =>
  meter().createHistogram('app.web_vitals.cls', {
    description: 'Cumulative layout shift of page loads measured in the browser',
    unit: '1',
    advice: { explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1] },
  }),
);

/** Where a failure came from: the first question of every incident. */
export type ErrorOrigin = 'application' | 'database' | 'dependency' | 'unavailable';

export function recordServerError(origin: ErrorOrigin, route: string | undefined): void {
  const attributes: Attributes = { 'error.origin': origin };
  if (route !== undefined) attributes['http.route'] = route;
  serverErrors().add(1, attributes);
}

export function recordDependencyCall(
  dependency: string,
  outcome: 'success' | 'http_error' | 'timeout' | 'network_error',
  seconds: number,
  statusCode?: number,
): void {
  const attributes: Attributes = { 'dependency.name': dependency, outcome };
  if (statusCode !== undefined) attributes['http.response.status_code'] = statusCode;
  dependencyDuration().record(seconds, attributes);
}

export function recordCacheRead(namespace: string, result: 'hit' | 'miss' | 'error'): void {
  cacheOperations().add(1, { 'cache.namespace': namespace, 'cache.result': result });
}

export function recordDegradation(feature: string, dependency: string): void {
  degradations().add(1, { feature, 'dependency.name': dependency });
}

export function recordSlowQuery(): void {
  slowQueries().add(1);
}

export type MailOutcome = 'sent' | 'retry' | 'failed' | 'expired';

/** One delivery attempt; `seconds` is the SMTP exchange (none for a message dropped unsent). */
export function recordMailDelivery(kind: string, outcome: MailOutcome, seconds?: number): void {
  const attributes: Attributes = { 'mail.kind': kind, outcome };
  mailDeliveries().add(1, attributes);
  if (seconds !== undefined) mailDeliveryDuration().record(seconds, attributes);
}

/** Queued to accepted, for a message the server accepted. */
export function recordMailLatency(kind: string, seconds: number): void {
  mailLatency().record(seconds, { 'mail.kind': kind });
}

export function recordMailSuppressed(kind: string): void {
  mailSuppressed().add(1, { 'mail.kind': kind });
}

/** Registers the outbox gauges; `read` returns the worker's latest reading. */
export function observeMailOutbox(read: () => MailOutboxGaugeValues | undefined): void {
  mailOutboxValues = read;
  mailOutboxGauges();
}

export type IngestEndpoint = 'events' | 'catalog' | 'heartbeat' | 'connector';
export type IngestRequestOutcome =
  'ok' | 'invalid' | 'unauthorized' | 'timestamp_skew' | 'replayed' | 'suspended' | 'rate_limited';

/** One signed request; `app` is the slug, or 'unknown' when no key was recognized. */
export function recordIngestRequest(
  app: string,
  endpoint: IngestEndpoint,
  outcome: IngestRequestOutcome,
): void {
  ingestRequests().add(1, { connected_app: app, endpoint, outcome });
}

/** Events of one batch with the same result; reason is a rejection's, 'none' otherwise. */
export function recordIngestEvents(
  app: string,
  outcome: 'accepted' | 'duplicate' | 'rejected',
  reason: string,
  count: number,
): void {
  if (count > 0) ingestEvents().add(count, { connected_app: app, outcome, reason });
}

export function recordIngestBatch(events: number): void {
  ingestBatchEvents().record(events);
}

/** Registers the connected applications' gauges; `read` returns the monitor's latest reading. */
export function observeConnectedApps(
  read: () => readonly ConnectedAppGaugeValues[] | undefined,
): void {
  connectedAppValues = read;
  connectedAppGauges();
}

export function recordIntegrityCheck(outcome: 'passed' | 'failed'): void {
  integrityChecks().add(1, { outcome });
}

/** Registers the sealing gauges; `read` returns the sealer's latest reading. */
export function observeIntegrity(read: () => readonly StreamGaugeValues[] | undefined): void {
  integrityValues = read;
  integrityGauges();
  // Both outcomes exist from the start, so increase() counts the first failure.
  for (const outcome of ['passed', 'failed'] as const) integrityChecks().add(0, { outcome });
}

/** Registers the jobs' last-success gauges: job name to Unix seconds. */
export function observeJobs(read: () => ReadonlyMap<string, number> | undefined): void {
  jobValues = read;
  jobGauges();
}

/** Registers the database privileges gauge; undefined until checked. */
export function observeDatabasePrivileges(read: () => boolean | undefined): void {
  privilegesValue = read;
  privilegesGauge();
}

export type WebhookOutcome =
  'delivered' | 'retry' | 'failed' | 'unauthorized' | 'expired' | 'refused';

/** One webhook attempt's outcome; connected_app is the slug ("none" for chat targets). */
export function recordWebhookDelivery(
  connectedApp: string,
  target: 'app' | 'slack' | 'teams',
  outcome: WebhookOutcome,
): void {
  webhookDeliveries().add(1, { connected_app: connectedApp, target, outcome });
}

/** Registers the webhook queue's gauges; `read` returns the worker's latest reading. */
export function observeWebhookOutbox(read: () => WebhookOutboxGaugeValues | undefined): void {
  webhookOutboxValues = read;
  webhookOutboxGauges();
}

/** Registers the open alerts gauge: severity to count. */
export function observeOpenAlerts(read: () => ReadonlyMap<string, number> | undefined): void {
  openAlertValues = read;
  openAlertsGauge();
}

/** Registers the real-time rules' lag gauge, in seconds. */
export function observeRulesLag(read: () => number | undefined): void {
  rulesLagValue = read;
  rulesLagGauge();
}

/** Registers the geolocation database's age gauge, in days (only when one is loaded). */
export function observeGeoIp(read: () => number | undefined): void {
  geoIpAgeValue = read;
  geoIpAgeGauge();
}

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

/**
 * One Web Vital of a page load: seconds for the timings, the score for CLS.
 * Every attribute comes from a closed list (telemetry/web-vitals.schemas.ts).
 */
export function recordWebVital(
  name: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB',
  value: number,
  page: { rating: WebVitalRating; navigationType: string; route: string },
): void {
  const attributes: Attributes = {
    'web_vital.rating': page.rating,
    'web_vital.navigation_type': page.navigationType,
    'page.route': page.route,
  };
  if (name === 'CLS') {
    webVitalLayoutShift().record(value, attributes);
  } else {
    webVitalDuration().record(value, { ...attributes, 'web_vital.name': name });
  }
}
