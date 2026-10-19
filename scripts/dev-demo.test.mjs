// Tests of scripts/dev-demo.mjs: the applications are connected as the
// connection guide says (one per backend and environment, the web and the
// mobile clients of one API in one), the data is what the contract and each
// catalog accept, the attacks pass the detection rules' thresholds while the
// history alone does not, and the script only ever talks to an API on this
// machine. No network: the parts that call Audit Hub are the ones the
// integration and end-to-end suites cover through the same API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AuditEventSchema,
  CatalogDocumentSchema,
  canonicalJsonBytes,
  compileFields,
  LIMITS,
} from '../packages/audit-contract/dist/index.js';
import {
  ATTACKER,
  attacksOf,
  batchesOf,
  catalogOf,
  DEMO_APPS,
  historyOf,
  localApi,
  numbered,
  peopleOf,
  randomOf,
  totpCode,
  TRAVELLER,
  travelOf,
} from './dev-demo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.UTC(2026, 9, 17, 15, 0, 0);
const KEY = Buffer.alloc(32, 7).toString('base64url');

/** The rules' thresholds, as the API defines them. */
const THRESHOLDS = Object.fromEntries(
  [
    ...readFileSync(join(ROOT, 'apps/api/src/rules/rules.constants.ts'), 'utf8').matchAll(
      /^export const ([A-Z_]+) = ([\d_]+);/gm,
    ),
  ].map(([, name, value]) => [name, Number((value ?? '').replaceAll('_', ''))]),
);

function threshold(/** @type {string} */ name) {
  const value = THRESHOLDS[name];
  if (value === undefined) throw new Error(`No ${name} in rules.constants.ts`);
  return value;
}

/** Every application with its people, history and attacks, as the script makes them. */
function generated() {
  return DEMO_APPS.map((app, index) => {
    const people = peopleOf(app, 20_261_016 + index);
    const options = { pseudonymKey: KEY, now: NOW, days: 21, seed: 7 + index };
    return {
      app,
      people,
      history: historyOf(app, people, options),
      attacks: attacksOf(app, people, options),
      travel: travelOf(app, people, { pseudonymKey: KEY, now: NOW + 65_000 }),
    };
  });
}

/** How many events of `events` share a key: the largest group. */
function largestGroup(
  /** @type {Record<string, any>[]} */ events,
  /** @type {(event: Record<string, any>) => string | undefined} */ keyOf,
  /** @type {(event: Record<string, any>) => string | undefined} */ distinctOf = () => undefined,
) {
  /** @type {Map<string, { count: number; distinct: Set<string> }>} */
  const groups = new Map();
  for (const event of events) {
    const key = keyOf(event);
    if (key === undefined) continue;
    const group = groups.get(key) ?? { count: 0, distinct: new Set() };
    group.count += 1;
    const distinct = distinctOf(event);
    if (distinct !== undefined) group.distinct.add(distinct);
    groups.set(key, group);
  }
  let count = 0;
  let distinct = 0;
  for (const group of groups.values()) {
    count = Math.max(count, group.count);
    distinct = Math.max(distinct, group.distinct.size);
  }
  return { count, distinct };
}

const failed = (/** @type {Record<string, any>} */ event) =>
  event.action === 'auth.session.sign_in_failed';
const ipOf = (/** @type {Record<string, any>} */ event) =>
  /** @type {string | undefined} */ (event.network?.ip);
const deviceOf = (/** @type {Record<string, any>} */ event) =>
  /** @type {string | undefined} */ (event.client?.deviceId);
const actorIdOf = (/** @type {Record<string, any>} */ event) =>
  /** @type {string | undefined} */ (event.actor?.id);
const clientTypeOf = (/** @type {Record<string, any>} */ event) =>
  /** @type {string | undefined} */ (event.client?.type);

function bySlug(/** @type {ReturnType<typeof generated>} */ all, /** @type {string} */ slug) {
  const found = all.find((entry) => entry.app.slug === slug);
  if (found === undefined) throw new Error(`No ${slug}`);
  return found;
}

describe('applications', () => {
  test('one per backend and environment: the shop in production and staging, the back office', () => {
    assert.deepEqual(
      DEMO_APPS.map((app) => [app.name, app.environment, app.slug]),
      [
        ['Tienda', 'production', 'tienda'],
        ['Tienda', 'staging', 'tienda-staging'],
        ['Backoffice', 'production', 'backoffice'],
      ],
    );
  });

  test("each application's catalog is a valid catalog document", () => {
    for (const app of DEMO_APPS) {
      assert.equal(CatalogDocumentSchema.safeParse(catalogOf(app)).success, true, app.slug);
    }
  });
});

describe('generated events', () => {
  const all = generated();

  test('are valid events of the contract and of their catalog', () => {
    for (const { app, history, attacks, travel } of all) {
      const catalog = catalogOf(app);
      const events = numbered([...history, ...attacks, ...travel], {
        next: 1,
        catalogVersion: '0123456789abcdef',
      });
      for (const event of events) {
        assert.equal(
          AuditEventSchema.safeParse(event).success,
          true,
          `${app.slug} ${event.action}`,
        );
        const spec = /** @type {Record<string, any>} */ (catalog.actions)[event.action];
        assert.ok(spec !== undefined, `${app.slug}: ${event.action} is in its catalog`);
        assert.equal(spec.category, event.category, event.action);
        if (spec.outcomes !== undefined) assert.ok(spec.outcomes.includes(event.outcome));
        if (event.details !== undefined) {
          const fields = spec.details?.fields ?? {};
          assert.equal(compileFields(fields).safeParse(event.details).success, true, event.action);
        }
        assert.equal(event.change === undefined || spec.change !== undefined, true, event.action);
        // What a device declares, only on the device's actions (Audit Hub: source_not_allowed),
        // and with the device's connector named.
        if (event.clientDeclared !== undefined) {
          assert.notEqual(spec.source, 'server', `${app.slug}: ${event.action} is a device's`);
          assert.match(event.client?.sdk?.name ?? '', /^audit-(web|expo)$/, event.action);
        }
        // Never an address or a number in clear: a pseudonym, a name, a masked phone.
        assert.doesNotMatch(JSON.stringify(event), /@example\.(com|org|net)/);
        assert.doesNotMatch(JSON.stringify(event), /\+52/);
        if (event.actor?.phoneLabel !== undefined) {
          assert.match(event.actor.phoneLabel, /^•••• [0-9]{4}$/);
        }
      }
    }
  });

  test('history: weeks of activity, oldest first, all in the past', () => {
    for (const { app, history } of all) {
      assert.ok(history.length > 20, `${app.slug}: ${String(history.length)} events`);
      const times = history.map((event) => Date.parse(event.occurredAt));
      assert.deepEqual(
        times,
        [...times].sort((a, b) => a - b),
      );
      assert.ok(Math.min(...times) >= NOW - 21 * 86_400_000);
      assert.ok(Math.max(...times) < NOW - 30 * 60_000);
      // No locations: the rules compare places by when Audit Hub received them.
      assert.equal(
        history.some((event) => 'location' in event),
        false,
      );
    }
  });

  test('the shop is one application for its web and mobile clients, one history per person', () => {
    const shop = bySlug(all, 'tienda');
    const types = new Set(shop.history.map(clientTypeOf));
    assert.deepEqual([...types].sort(), ['android', 'ios', 'web']);
    // Someone who uses both: both clients, under one account.
    const both = shop.people.find((person) => person.channel === 'both');
    assert.ok(both !== undefined);
    const theirs = shop.history.filter((event) => actorIdOf(event) === both.id);
    assert.ok(theirs.some((event) => clientTypeOf(event) === 'web'));
    assert.ok(theirs.some((event) => deviceOf(event) === both.deviceId));
  });

  test('the same seed gives the same history', () => {
    const app = DEMO_APPS[0];
    assert.ok(app !== undefined);
    const people = peopleOf(app, 1);
    const options = { pseudonymKey: KEY, now: NOW, days: 5, seed: 3 };
    assert.deepEqual(historyOf(app, people, options), historyOf(app, people, options));
  });

  test('history alone raises no periodic alert: it all reaches Audit Hub at once', () => {
    for (const { app, history } of all) {
      const failures = history.filter(failed);
      const byAccount = largestGroup(failures, (event) => event.actor.id);
      const byIp = largestGroup(failures, ipOf, (event) => event.actor.id);
      assert.ok(byAccount.count < threshold('BRUTE_FORCE_ACCOUNT'), app.slug);
      assert.ok(byIp.count < threshold('BRUTE_FORCE_IP'), app.slug);
      assert.ok(byIp.distinct < threshold('STUFFING_ACCOUNTS'), app.slug);
      const exports = history.filter((event) => event.action === 'reports.sales.exported');
      assert.ok(largestGroup(exports, (event) => event.actor.id).count < threshold('MASS_EXPORT'));
      const reads = history.filter((event) => event.action === 'iam.user.viewed');
      assert.ok(largestGroup(reads, (event) => event.actor.id).count < threshold('MASS_READ'));
    }
  });

  test("the attacks pass the rules' thresholds", () => {
    const shop = bySlug(all, 'tienda');
    const backoffice = bySlug(all, 'backoffice');
    const shopFailures = shop.attacks.filter(failed);
    assert.ok(
      largestGroup(shopFailures, (event) => event.actor.id).count >=
        threshold('BRUTE_FORCE_ACCOUNT'),
    );
    const stuffing = largestGroup(shopFailures, ipOf, (event) => event.actor.id);
    assert.ok(stuffing.count >= threshold('BRUTE_FORCE_IP'));
    assert.ok(stuffing.distinct >= threshold('STUFFING_ACCOUNTS'));
    // The same address against the shop and the back office, both correlated.
    for (const entry of [shop, backoffice]) {
      assert.equal(entry.app.correlated, true, entry.app.slug);
      assert.ok(
        entry.attacks.filter(failed).filter((event) => ipOf(event) === ATTACKER.stuffing).length >=
          threshold('MULTI_APP_FAILURES'),
        entry.app.slug,
      );
    }
    assert.ok(shop.attacks.some((event) => event.action === 'auth.session.reuse_detected'));
    assert.ok(backoffice.attacks.some((event) => event.action === 'iam.user.role_changed'));
    const exports = backoffice.attacks.filter((event) => event.action === 'reports.sales.exported');
    assert.ok(largestGroup(exports, (event) => event.actor.id).count >= threshold('MASS_EXPORT'));
  });

  test('a known account on a new phone, which reports Mexico City, then Madrid a minute later', () => {
    const shop = bySlug(all, 'tienda');
    const traveller = shop.people[TRAVELLER];
    assert.ok(traveller !== undefined);
    assert.ok(
      shop.history.some((event) => deviceOf(event) === traveller.deviceId),
      'the account used its own phone before',
    );
    const newPhone = /** @type {Record<string, any> | undefined} */ (
      shop.attacks.find((event) => event.action === 'auth.session.signed_in')
    );
    assert.ok(newPhone !== undefined);
    assert.equal(newPhone.actor.id, traveller.id);
    assert.ok(!shop.history.some((event) => deviceOf(event) === deviceOf(newPhone)));
    const started = [...shop.attacks, ...shop.travel].filter(
      (event) => event.action === 'client.session.started',
    );
    assert.equal(started.length, 2);
    const [here, there] = /** @type {Record<string, any>[]} */ (started);
    assert.equal(here?.actor.id, traveller.id);
    assert.equal(there?.actor.id, traveller.id);
    assert.equal(deviceOf(here ?? {}), deviceOf(newPhone));
    assert.ok(Math.abs((here?.location.longitude ?? 0) - (there?.location.longitude ?? 0)) > 90);
  });

  test('staging is silent now: no attack, no travel', () => {
    const staging = bySlug(all, 'tienda-staging');
    assert.equal(staging.app.silent, true);
    assert.deepEqual([staging.attacks, staging.travel], [[], []]);
  });
});

describe('numbered', () => {
  test('numbers without gaps, or with the one asked for', () => {
    const drafts = [0, 1, 2, 3].map((n) => ({
      occurredAt: new Date(NOW + n).toISOString(),
      category: 'security',
      action: 'auth.session.signed_out',
      outcome: 'success',
      actor: { type: 'user', id: `u-${String(n)}` },
    }));
    const sequence = { next: 1, catalogVersion: '0123456789abcdef' };
    assert.deepEqual(
      numbered(drafts, sequence).map((event) => event.sourceSeq),
      [1, 2, 3, 4],
    );
    const gapped = { next: 1, catalogVersion: '0123456789abcdef', skip: 3 };
    assert.deepEqual(
      numbered(drafts, gapped).map((event) => event.sourceSeq),
      [1, 2, 4, 5],
    );
    assert.equal(gapped.next, 6);
  });
});

describe('batchesOf', () => {
  test("at most 100 events and under the contract's byte limit", () => {
    const events = Array.from({ length: 250 }, (_, n) => ({ n, text: 'x'.repeat(2_000) }));
    const batches = batchesOf(events);
    assert.deepEqual(batches.flat(), events);
    for (const batch of batches) {
      assert.ok(batch.length <= LIMITS.batchEvents);
      assert.ok(canonicalJsonBytes(batch) < LIMITS.batchBytes);
    }
  });
});

describe('totpCode', () => {
  test('RFC 6238 (SHA-1): the test vectors, their last six digits', () => {
    // The RFC's key "12345678901234567890", in base32.
    assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
    assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1_111_111_109_000), '081804');
  });

  test('refuses a key that is not base32', () => {
    assert.throws(() => totpCode('not base32!', 0), /not base32/);
  });
});

describe('localApi', () => {
  test('the API on this machine, as its origin', () => {
    assert.equal(localApi('http://127.0.0.1:3200/api'), 'http://127.0.0.1:3200');
    assert.equal(localApi('http://localhost:3200'), 'http://localhost:3200');
    assert.equal(localApi('http://[::1]:3200'), 'http://[::1]:3200');
  });

  test("refuses any other: the seed's credentials are public", () => {
    for (const url of [
      'https://audit.example.com',
      'http://10.0.0.5:3200',
      'http://127.0.0.1.nip.io',
    ]) {
      assert.throws(() => localApi(url), /not on this machine/, url);
    }
  });
});

describe('randomOf', () => {
  test('the same seed, the same sequence; integers within their bounds', () => {
    const a = randomOf(42);
    const b = randomOf(42);
    const values = Array.from({ length: 50 }, () => a.int(3, 9));
    assert.deepEqual(
      values,
      Array.from({ length: 50 }, () => b.int(3, 9)),
    );
    assert.ok(values.every((value) => value >= 3 && value <= 9));
    assert.throws(() => a.pick([]), /Nothing to pick/);
  });
});
