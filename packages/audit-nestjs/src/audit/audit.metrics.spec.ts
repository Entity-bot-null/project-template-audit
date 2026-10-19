import {
  type Attributes,
  type Counter,
  createNoopMeter,
  type Meter,
  type MeterProvider,
  metrics,
  type ObservableCallback,
  type ObservableGauge,
  type ObservableResult,
} from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  observeQueue,
  type QueueGaugeValues,
  recordEvents,
  recordHubRequest,
} from './audit.metrics.js';

interface Added {
  counter: string;
  value: number;
  attributes: Attributes | undefined;
}

interface Gauge {
  name: string;
  unit: string | undefined;
  callbacks: ObservableCallback[];
}

/** A meter that keeps what the connector does with it. */
class FakeMeter {
  readonly added: Added[] = [];
  readonly gauges: Gauge[] = [];
  readonly meter: Meter;

  constructor() {
    // An object of its own (createNoopMeter() is a singleton), the unused
    // instruments inherited from it.
    this.meter = Object.assign(Object.create(createNoopMeter()) as Meter, {
      createCounter: (name: string): Counter => ({
        add: (value: number, attributes?: Attributes) => {
          this.added.push({ counter: name, value, attributes });
        },
      }),
      createObservableGauge: (name: string, options?: { unit?: string }): ObservableGauge => {
        const gauge: Gauge = { name, unit: options?.unit, callbacks: [] };
        this.gauges.push(gauge);
        return {
          addCallback: (callback: ObservableCallback) => {
            gauge.callbacks.push(callback);
          },
          removeCallback: (callback: ObservableCallback) => {
            gauge.callbacks = gauge.callbacks.filter((candidate) => candidate !== callback);
          },
        };
      },
    });
  }

  /** What each gauge observes when the SDK collects. */
  async collect(): Promise<Record<string, number[]>> {
    const observed: Record<string, number[]> = {};
    for (const gauge of this.gauges) {
      const values: number[] = [];
      const result: ObservableResult = {
        observe: (value: number) => {
          values.push(value);
        },
      };
      for (const callback of gauge.callbacks) await callback(result);
      observed[gauge.name] = values;
    }
    return observed;
  }
}

// The meter provider the SDK registers when telemetry is on. The connector's
// counters are created on first use and kept: one fake for the whole file.
const installed = new FakeMeter();
const provider: MeterProvider = { getMeter: () => installed.meter };

beforeEach(() => {
  metrics.setGlobalMeterProvider(provider);
  installed.added.length = 0;
});

afterEach(() => {
  metrics.disable();
});

describe('recordEvents', () => {
  it('counts the events Audit Hub answered for, by outcome', () => {
    recordEvents('accepted', 3);
    recordEvents('retry', 1);
    expect(installed.added).toEqual([
      { counter: 'app.audit.events', value: 3, attributes: { outcome: 'accepted' } },
      { counter: 'app.audit.events', value: 1, attributes: { outcome: 'retry' } },
    ]);
  });

  it('counts nothing for no event', () => {
    recordEvents('rejected', 0);
    expect(installed.added).toEqual([]);
  });
});

describe('recordHubRequest', () => {
  it('counts each request by kind and outcome', () => {
    recordHubRequest('heartbeat', 'ok');
    recordHubRequest('events', 'rate_limited');
    expect(installed.added).toEqual([
      {
        counter: 'app.audit.hub.requests',
        value: 1,
        attributes: { kind: 'heartbeat', outcome: 'ok' },
      },
      {
        counter: 'app.audit.hub.requests',
        value: 1,
        attributes: { kind: 'events', outcome: 'rate_limited' },
      },
    ]);
  });
});

describe('observeQueue', () => {
  it('reports the queue size and the age of its oldest event', async () => {
    const fake = new FakeMeter();
    let values: QueueGaugeValues | undefined = { waiting: 12, oldestAgeSeconds: 90 };
    observeQueue(
      () => values,
      () => fake.meter,
    );
    expect(fake.gauges.map((gauge) => [gauge.name, gauge.unit])).toEqual([
      ['app.audit.outbox.waiting', undefined],
      ['app.audit.outbox.oldest_age', 's'],
    ]);
    await expect(fake.collect()).resolves.toEqual({
      'app.audit.outbox.waiting': [12],
      'app.audit.outbox.oldest_age': [90],
    });
    values = undefined;
    await expect(fake.collect()).resolves.toEqual({
      'app.audit.outbox.waiting': [],
      'app.audit.outbox.oldest_age': [],
    });
  });

  it('registers once per meter', async () => {
    const fake = new FakeMeter();
    const read = () => ({ waiting: 1, oldestAgeSeconds: 2 });
    observeQueue(read, () => fake.meter);
    observeQueue(read, () => fake.meter);
    expect(fake.gauges).toHaveLength(2);
    await expect(fake.collect()).resolves.toEqual({
      'app.audit.outbox.waiting': [1],
      'app.audit.outbox.oldest_age': [2],
    });

    const other = new FakeMeter();
    observeQueue(read, () => other.meter);
    expect(other.gauges).toHaveLength(2);
  });

  it('uses the global meter by default', async () => {
    observeQueue(() => ({ waiting: 5, oldestAgeSeconds: 0 }));
    observeQueue(() => ({ waiting: 6, oldestAgeSeconds: 1 }));
    expect(installed.gauges).toHaveLength(2);
    await expect(installed.collect()).resolves.toEqual({
      'app.audit.outbox.waiting': [5],
      'app.audit.outbox.oldest_age': [0],
    });
  });
});
