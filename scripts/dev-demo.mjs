// `pnpm dev:demo`: demo data for the local Audit Hub, so its pages have
// something to show. It goes through Audit Hub's real interfaces only, as
// people and connectors do: the seed's administrator signs in (its public
// second factor), registers the applications, and each one sends weeks of its
// audit log (a published catalog, signed batches numbered without gaps, a
// heartbeat). The alerts that history raises (a person's second device) are
// reviewed, as an auditor would have over those weeks. Then a few attacks
// happen now, which the detection rules turn into alerts: at once for the
// real-time ones, within five minutes for the periodic ones
// (docs/security.md#detection-rules).
//
// The applications are connected as docs/audit/connection-guide.md says: one
// per backend and environment. The shop is one API with a web app and a
// mobile app on top: one application, whose events say which client they came
// from; its staging environment is another; the back office is another
// backend. What a device declares (a session expired, where the phone is)
// reaches Audit Hub through its API, never directly.
//
//   pnpm dev:demo [--api http://127.0.0.1:3200] [--days 21] [--suffix <x>]
//
// Development only: it signs in with public credentials, so it refuses an API
// that is not on this machine. A second run changes nothing else (the
// applications exist): it only gives the seed's auditor and viewer the demo's
// applications again; `--suffix` adds another set of them (tienda-<x>, ...).
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import {
  AuditEventSchema,
  CatalogDocumentSchema,
  canonicalJsonBytes,
  CONTRACT_VERSION,
  LIMITS,
  maskPhone,
  uuidv7,
} from '../packages/audit-contract/dist/index.js';
import {
  emailHmac,
  nodeRandomFill,
  secretKey,
  signRequest,
} from '../packages/audit-contract/dist/node/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The seed's administrator and its public second factor (apps/api/src/seed/seed.ts). */
const ADMIN = { email: 'admin@example.com', password: 'admin-password' };
const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- the seed's public development key

/** Every application is a NestJS API from the template, with its connector. */
const CONNECTOR = {
  name: 'audit-nestjs',
  version: /** @type {{ version: string }} */ (
    JSON.parse(readFileSync(join(ROOT, 'packages/audit-nestjs/package.json'), 'utf8'))
  ).version,
};
/** The version of one of this repository's packages. */
const versionOf = (/** @type {string} */ name) =>
  /** @type {{ version: string }} */ (
    JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'))
  ).version;
/** The devices' connectors, which send through their API (F8). */
const DEVICE_SDK = {
  web: { name: 'audit-web', version: versionOf('audit-web') },
  mobile: { name: 'audit-expo', version: versionOf('audit-expo') },
};

/**
 * @typedef {object} DemoApp
 * @property {'shop' | 'backoffice'} kind
 * @property {string} slug
 * @property {string} name
 * @property {string} environment
 * @property {string} appVersion  The API's release, as its heartbeat reports it.
 * @property {string} mobileVersion  The mobile app's release (the shop's clients).
 * @property {number} people   Accounts that use it.
 * @property {[number, number]} perDay  Accounts active on a day, at least and at most.
 * @property {boolean} silent  Its API down now: no heartbeat, and one event lost (a gap).
 * @property {boolean} correlated  Cross-application correlation enabled.
 */

/** @type {readonly DemoApp[]} */
export const DEMO_APPS = [
  {
    kind: 'shop',
    slug: 'tienda',
    name: 'Tienda',
    environment: 'production',
    appVersion: '3.8.1',
    mobileVersion: '2.4.0',
    people: 60,
    perDay: [22, 40],
    silent: false,
    correlated: true,
  },
  {
    kind: 'shop',
    slug: 'tienda-staging',
    name: 'Tienda',
    environment: 'staging',
    appVersion: '3.9.0-rc.2',
    mobileVersion: '2.5.0-beta.1',
    people: 6,
    perDay: [1, 4],
    silent: true,
    correlated: false,
  },
  {
    kind: 'backoffice',
    slug: 'backoffice',
    name: 'Backoffice',
    environment: 'production',
    appVersion: '1.12.0',
    mobileVersion: '',
    people: 8,
    perDay: [4, 8],
    silent: false,
    correlated: true,
  },
];

// --- Pure parts: the catalogs, the people, their history, the attacks -------

/** The template's flows as the NestJS connector declares them (its base catalog). */
const BASE = {
  'auth.session.signed_in': {
    category: 'security',
    severity: 'info',
    description: 'A user signed in.',
    source: 'server',
    tags: ['auth.sign_in'],
    userVisible: true,
    details: {
      fields: { method: { type: 'enum', values: ['password', 'mfa', 'sign_up', 'invitation'] } },
    },
  },
  'auth.session.sign_in_failed': {
    category: 'security',
    severity: 'low',
    description: 'A sign-in was refused.',
    source: 'server',
    outcomes: ['failure', 'denied'],
    tags: ['auth.sign_in_failed'],
    userVisible: true,
  },
  'auth.session.signed_out': {
    category: 'security',
    severity: 'info',
    description: 'A user signed out.',
    source: 'server',
    tags: ['auth.sign_out'],
    userVisible: true,
  },
  'auth.session.reuse_detected': {
    category: 'security',
    severity: 'high',
    description:
      'A refresh token was presented again after its rotation: its whole session family was ended.',
    source: 'server',
    tags: ['auth.session_reuse'],
    userVisible: true,
  },
  'auth.password.changed': {
    category: 'security',
    severity: 'medium',
    description: 'A user changed their password.',
    source: 'server',
    tags: ['auth.credential_changed'],
    userVisible: true,
  },
  'auth.password_reset.requested': {
    category: 'security',
    severity: 'info',
    description: 'A password reset link was asked for.',
    source: 'server',
    tags: ['auth.recovery'],
  },
  'auth.password_reset.completed': {
    category: 'security',
    severity: 'medium',
    description: 'A password was reset with an emailed link.',
    source: 'server',
    tags: ['auth.recovery', 'auth.credential_changed'],
    userVisible: true,
  },
};

/** What each kind of application declares on top. */
const OWN = {
  shop: {
    'shop.order.placed': {
      category: 'audit',
      severity: 'info',
      description: 'A customer placed an order.',
      source: 'server',
      resourceType: 'order',
      details: {
        fields: { totalCents: { type: 'integer', min: 0 }, items: { type: 'integer', min: 1 } },
      },
    },
    'shop.order.refunded': {
      category: 'audit',
      severity: 'medium',
      description: 'A member of staff refunded an order.',
      source: 'server',
      resourceType: 'order',
      details: { fields: { amountCents: { type: 'integer', min: 0 } } },
    },
    // The devices' own events, which the apps send through the API, as the
    // connector's base catalog declares them.
    'client.session.started': {
      category: 'security',
      severity: 'info',
      description:
        "The app opened a session: after a sign-in, or with the one it kept. With the user's consent, it says where the phone was.",
      source: 'client',
      tags: ['auth.sign_in'],
    },
    'client.session.expired': {
      category: 'security',
      severity: 'low',
      description: 'The app found its session expired.',
      source: 'client',
    },
    'client.security.csp_violation': {
      category: 'security',
      severity: 'low',
      description: 'The browser blocked something the Content Security Policy forbids.',
      source: 'client',
      details: {
        fields: {
          directive: { type: 'string', maxLength: 64 },
          blockedOrigin: { type: 'string', maxLength: 256 },
        },
      },
    },
  },
  backoffice: {
    'iam.user.role_changed': {
      category: 'audit',
      severity: 'high',
      description: "An administrator changed a user's role.",
      source: 'server',
      tags: ['iam.privilege_changed'],
      resourceType: 'user',
      change: { fields: { role: { type: 'string', maxLength: 64 } } },
    },
    'iam.user.viewed': {
      category: 'access',
      severity: 'info',
      description: "An administrator opened another user's account.",
      source: 'server',
      tags: ['data.read_other_user'],
      resourceType: 'user',
    },
    'iam.invitation.created': {
      category: 'audit',
      severity: 'low',
      description: 'An administrator invited someone.',
      source: 'server',
      resourceType: 'invitation',
      details: { fields: { role: { type: 'string', maxLength: 64 } } },
    },
    'reports.sales.exported': {
      category: 'access',
      severity: 'medium',
      description: 'A member of staff exported the sales report.',
      source: 'server',
      tags: ['data.bulk_export'],
      details: { fields: { rows: { type: 'integer', min: 0 } } },
    },
  },
};

/** The catalog an application publishes. */
export function catalogOf(/** @type {DemoApp} */ app) {
  return {
    catalogFormat: 1,
    app: { name: app.slug, version: app.appVersion },
    ...(app.kind === 'shop' ? { responseActions: ['revoke_sessions'] } : {}),
    actions: { ...BASE, ...OWN[app.kind] },
  };
}

/** A small deterministic generator (mulberry32): the same seed, the same data. */
export function randomOf(/** @type {number} */ seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    /** An integer in [min, max]. */
    int: (/** @type {number} */ min, /** @type {number} */ max) =>
      min + Math.floor(next() * (max - min + 1)),
    chance: (/** @type {number} */ probability) => next() < probability,
    pick:
      /**
       * @template T
       * @param {readonly T[]} items
       * @returns {T}
       */ (items) => {
        const item = items[Math.floor(next() * items.length)];
        if (item === undefined) throw new Error('Nothing to pick from');
        return item;
      },
  };
}

const FIRST = [
  'Ana',
  'Luis',
  'María',
  'Carlos',
  'Sofía',
  'Jorge',
  'Valeria',
  'Diego',
  'Fernanda',
  'Miguel',
  'Camila',
  'Andrés',
  'Daniela',
  'Ricardo',
  'Lucía',
  'Javier',
  'Paola',
  'Héctor',
  'Regina',
  'Emilio',
];
const LAST = [
  'García',
  'Hernández',
  'López',
  'Martínez',
  'González',
  'Pérez',
  'Rodríguez',
  'Sánchez',
  'Ramírez',
  'Torres',
  'Flores',
  'Rivera',
];
const DOMAINS = ['example.com', 'example.org', 'example.net'];
/**
 * Browsers as they present themselves: their user agent and, from Chromium
 * ones, the client hints the API's connector forwards (the real brand,
 * Windows 11 told from 10). Safari and Firefox send none.
 */
const BROWSERS = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    clientHints: {
      brands: [
        { brand: 'Google Chrome', version: '141.0.7390.65' },
        { brand: 'Chromium', version: '141.0.7390.65' },
      ],
      platform: 'Windows',
      platformVersion: '15.0.0',
      mobile: false,
    },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0' },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    clientHints: {
      brands: [
        { brand: 'Microsoft Edge', version: '141.0.3537.71' },
        { brand: 'Chromium', version: '141.0.7390.65' },
      ],
      platform: 'Windows',
      platformVersion: '10.0.0',
      mobile: false,
    },
  },
];
/** How each account of the shop uses it, by its position: web, the mobile app, or both. */
const CHANNELS = /** @type {const} */ (['web', 'web', 'mobile', 'mobile', 'both']);

/**
 * @typedef {object} Person
 * @property {string} id
 * @property {string} email
 * @property {string} name       Their full name: their label in Audit Hub.
 * @property {string} [phone]    Linked to the account by half of them: it leaves only masked.
 * @property {string} role
 * @property {'web' | 'mobile' | 'both'} channel
 * @property {string} webIp      At home, on the web app.
 * @property {string} mobileIp   On a mobile network, in the app.
 * @property {string} userAgent  Their browser.
 * @property {Record<string, unknown>} [clientHints] What it says beyond its user agent.
 * @property {string} deviceId   Their phone's installation of the app.
 * @property {'ios' | 'android'} platform
 */

/** The accounts of an application: stable addresses, browsers and phones. */
export function peopleOf(/** @type {DemoApp} */ app, /** @type {number} */ seed) {
  const random = randomOf(seed);
  const base = app.kind === 'backoffice' ? 3000 : app.environment === 'staging' ? 5000 : 1000;
  const staging = app.environment === 'staging';
  /** @type {Person[]} */
  const people = [];
  for (let index = 0; index < app.people; index += 1) {
    const first = FIRST[(index * 7) % FIRST.length] ?? 'Ana';
    const last = LAST[(index * 5) % LAST.length] ?? 'García';
    const local = `${first}.${last}${String(index + 1)}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const host = 10 + index;
    const browser = random.pick(BROWSERS);
    people.push({
      id: `u-${String(base + index + 1)}`,
      email: `${local}@${random.pick(DOMAINS)}`,
      name: `${first} ${last}`,
      // Fictitious numbers (55 0000 xxxx): only their last four digits ever leave.
      ...(index % 2 === 0 ? { phone: `+52 55 0000 ${String(1000 + base + index)}` } : {}),
      role:
        app.kind === 'backoffice'
          ? index === 0
            ? 'admin'
            : 'staff'
          : index < 2
            ? 'staff'
            : 'customer',
      channel: app.kind === 'backoffice' ? 'web' : (CHANNELS[index % CHANNELS.length] ?? 'web'),
      // Testers of staging, the office of the back office, customers at home.
      webIp: staging
        ? `192.0.2.${String(100 + index)}`
        : app.kind === 'backoffice'
          ? `192.0.2.${String(host)}`
          : `203.0.113.${String(host)}`,
      mobileIp: staging ? `192.0.2.${String(150 + index)}` : `198.51.100.${String(host)}`,
      userAgent: browser.userAgent,
      ...(browser.clientHints === undefined ? {} : { clientHints: browser.clientHints }),
      deviceId: `device-${app.slug}-${String(index + 1).padStart(4, '0')}`,
      platform: random.chance(0.6) ? 'ios' : 'android',
    });
  }
  return people;
}

/**
 * @typedef {Record<string, unknown> & { occurredAt: string }} Draft
 *   An event without its id, number and catalog version (they come when it is sent).
 */

/**
 * Who acts in an application's events: the account, its email's pseudonym,
 * its name, and its phone's last four digits when it has one linked.
 */
function actorOf(/** @type {Person} */ person, /** @type {string} */ pseudonymKey) {
  const phone = person.phone === undefined ? undefined : maskPhone(person.phone);
  return {
    type: 'user',
    id: person.id,
    role: person.role,
    emailHmac: emailHmac(secretKey(pseudonymKey), person.email),
    label: person.name,
    ...(phone === undefined ? {} : { phoneLabel: phone }),
  };
}

/**
 * Where a request came from, as the API's connector records it: the address
 * TRUST_PROXY resolved, and the client its headers name (X-Platform,
 * X-App-Version, X-Device-Id): the web app, or the phone's installation.
 */
function clientOf(
  /** @type {DemoApp} */ app,
  /** @type {Person} */ person,
  /** @type {'web' | 'mobile'} */ channel,
) {
  if (channel === 'web') {
    return {
      network: {
        ip: person.webIp,
        userAgent: person.userAgent,
        ...(person.clientHints === undefined ? {} : { clientHints: person.clientHints }),
      },
      client: { type: 'web', appVersion: app.appVersion },
    };
  }
  return {
    network: {
      ip: person.mobileIp,
      userAgent: `Tienda/${app.mobileVersion} (${person.platform === 'ios' ? 'iOS 18.1' : 'Android 15'})`,
    },
    client: {
      type: person.platform,
      appVersion: app.mobileVersion,
      deviceId: person.deviceId,
      os: person.platform === 'ios' ? 'iOS' : 'Android',
    },
  };
}

/** A request the event came with. */
function request(
  /** @type {string} */ method,
  /** @type {string} */ route,
  /** @type {number} */ status,
) {
  return { method, route, status };
}

/**
 * Weeks of an application's audit log, oldest first: who signed in (on the web
 * or in the app), failed, signed out, changed a password, and what each kind
 * of application does. Every event before `until`; history has no locations
 * (the rules compare places by the time Audit Hub received them, which is now
 * for all of it).
 */
export function historyOf(
  /** @type {DemoApp} */ app,
  /** @type {Person[]} */ people,
  /** @type {{ pseudonymKey: string; now: number; days: number; seed: number }} */ options,
) {
  const random = randomOf(options.seed);
  const until = options.now - 30 * MINUTE_MS;
  const start = options.now - options.days * DAY_MS;
  /** @type {Draft[]} */
  const events = [];
  const add = (/** @type {number} */ at, /** @type {Record<string, unknown>} */ event) => {
    if (at < until) events.push({ ...event, occurredAt: new Date(at).toISOString() });
  };
  for (let day = start; day < until; day += DAY_MS) {
    const active = random.int(app.perDay[0], app.perDay[1]);
    for (let n = 0; n < active; n += 1) {
      const person = random.pick(people);
      /** @type {'web' | 'mobile'} */
      const channel =
        person.channel === 'both' ? (random.chance(0.5) ? 'web' : 'mobile') : person.channel;
      const who = {
        actor: actorOf(person, options.pseudonymKey),
        ...clientOf(app, person, channel),
      };
      const sdk = DEVICE_SDK[channel];
      // Between 07:00 and 23:00 of the day, in minutes.
      let at = day + (7 * 60 + random.int(0, 16 * 60)) * MINUTE_MS;
      if (random.chance(0.12)) {
        add(at, {
          ...who,
          category: 'security',
          action: 'auth.session.sign_in_failed',
          outcome: 'failure',
          reason: 'invalid_credentials',
          request: request('POST', '/api/auth/sign-in', 401),
        });
        at += random.int(1, 3) * MINUTE_MS;
      }
      add(at, {
        ...who,
        category: 'security',
        action: 'auth.session.signed_in',
        outcome: 'success',
        request: request('POST', '/api/auth/sign-in', 200),
        details: { method: app.kind === 'backoffice' ? 'mfa' : 'password' },
      });
      at += random.int(2, 40) * MINUTE_MS;
      if (app.kind === 'shop' && person.role === 'customer' && random.chance(0.45)) {
        add(at, {
          ...who,
          category: 'audit',
          action: 'shop.order.placed',
          outcome: 'success',
          resource: { type: 'order', id: `o-${String(random.int(100_000, 999_999))}` },
          request: request('POST', '/api/orders', 201),
          details: { totalCents: random.int(1_500, 450_000), items: random.int(1, 6) },
        });
        at += random.int(1, 10) * MINUTE_MS;
      }
      if (app.kind === 'shop' && person.role === 'staff' && random.chance(0.3)) {
        add(at, {
          ...who,
          category: 'audit',
          action: 'shop.order.refunded',
          outcome: 'success',
          resource: { type: 'order', id: `o-${String(random.int(100_000, 999_999))}` },
          request: request('POST', '/api/orders/:id/refund', 200),
          details: { amountCents: random.int(1_500, 120_000) },
        });
        at += random.int(1, 10) * MINUTE_MS;
      }
      if (app.kind === 'shop' && random.chance(0.12)) {
        // The device's own event: sent to the API, which forwards it.
        add(at, {
          ...who,
          client: { ...who.client, sdk },
          category: 'security',
          action: 'client.session.expired',
          outcome: 'success',
          clientDeclared: ['occurredAt', 'client'],
        });
        at += random.int(1, 5) * MINUTE_MS;
      }
      if (app.kind === 'shop' && channel === 'web' && random.chance(0.03)) {
        add(at, {
          ...who,
          client: { ...who.client, sdk },
          category: 'security',
          action: 'client.security.csp_violation',
          outcome: 'denied',
          clientDeclared: ['occurredAt', 'client', 'details'],
          details: { directive: 'script-src', blockedOrigin: 'https://cdn.tracker.example' },
        });
      }
      if (app.kind === 'backoffice') {
        if (random.chance(0.4)) {
          const other = random.pick(people);
          if (other.id !== person.id) {
            add(at, {
              ...who,
              category: 'access',
              action: 'iam.user.viewed',
              outcome: 'success',
              resource: { type: 'user', id: other.id },
              request: request('GET', '/api/users/:id', 200),
            });
            at += random.int(1, 10) * MINUTE_MS;
          }
        }
        if (random.chance(0.08)) {
          add(at, {
            ...who,
            category: 'access',
            action: 'reports.sales.exported',
            outcome: 'success',
            request: request('GET', '/api/reports/sales', 200),
            details: { rows: random.int(200, 20_000) },
          });
          at += random.int(1, 10) * MINUTE_MS;
        }
        if (person.role === 'admin' && random.chance(0.15)) {
          add(at, {
            ...who,
            category: 'audit',
            action: 'iam.invitation.created',
            outcome: 'success',
            resource: { type: 'invitation', id: `inv-${String(random.int(1000, 9999))}` },
            request: request('POST', '/api/invitations', 201),
            details: { role: 'staff' },
          });
          at += random.int(1, 10) * MINUTE_MS;
        }
      }
      if (random.chance(0.02)) {
        add(at, {
          ...who,
          category: 'security',
          action: 'auth.password.changed',
          outcome: 'success',
          resource: { type: 'user', id: person.id },
          request: request('POST', '/api/account/password', 200),
        });
        at += MINUTE_MS;
      }
      if (random.chance(0.03)) {
        add(at, {
          ...who,
          category: 'security',
          action: 'auth.password_reset.requested',
          outcome: 'success',
          request: request('POST', '/api/auth/password-resets', 202),
        });
        if (random.chance(0.7)) {
          add(at + random.int(3, 30) * MINUTE_MS, {
            ...who,
            category: 'security',
            action: 'auth.password_reset.completed',
            outcome: 'success',
            resource: { type: 'user', id: person.id },
            request: request('POST', '/api/auth/password-resets/confirm', 200),
          });
        }
      }
      if (random.chance(0.4)) {
        add(at + random.int(5, 120) * MINUTE_MS, {
          ...who,
          category: 'security',
          action: 'auth.session.signed_out',
          outcome: 'success',
          request: request('POST', '/api/auth/logout', 204),
        });
      }
    }
  }
  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** Addresses of the attacks: never one of the people's. */
export const ATTACKER = { guessing: '203.0.113.200', stuffing: '198.51.100.250' };

/** The phone of the mobile scene: one the account never used, on another network. */
const NEW_PHONE = { deviceId: 'device-tienda-unknown-77', ip: '198.51.100.240' };
// Where the phone of the mobile scene says it is: its precise position (the
// person allowed it), a fresh fix at sign-in.
const MEXICO_CITY = { latitude: 19.43261, longitude: -99.13321 };
const MADRID = { latitude: 40.41689, longitude: -3.70379 };
/** The account of the mobile scene: one that uses both the web and the app. */
export const TRAVELLER = 4;

/**
 * What happens now, past the rules' thresholds (apps/api/src/rules/rules.constants.ts):
 * guessing one account's password, trying many accounts from one address on
 * the shop and then the back office, a refresh token used again, a sign-in
 * from a new phone, a role raised, the sales report exported again and again.
 * The phone's second report (impossible travel) is `travelOf`, a minute later.
 */
export function attacksOf(
  /** @type {DemoApp} */ app,
  /** @type {Person[]} */ people,
  /** @type {{ pseudonymKey: string; now: number }} */ options,
) {
  /** @type {Draft[]} */
  const events = [];
  if (app.silent) return events;
  let at = options.now - 3 * MINUTE_MS;
  const add = (/** @type {Record<string, unknown>} */ event) => {
    at += 1_000;
    events.push({ ...event, occurredAt: new Date(at).toISOString() });
  };
  const person = (/** @type {number} */ index) => {
    const found = people[index];
    if (found === undefined) throw new Error(`No person ${String(index)} in ${app.slug}`);
    return found;
  };
  // A script, not a person: the account's actor, the attacker's address and tool.
  const failure = (/** @type {Person} */ target, /** @type {string} */ ip) => ({
    actor: actorOf(target, options.pseudonymKey),
    network: { ip, userAgent: 'python-requests/2.32.3' },
    category: 'security',
    action: 'auth.session.sign_in_failed',
    outcome: 'failure',
    reason: 'invalid_credentials',
    request: request('POST', '/api/auth/sign-in', 401),
  });
  if (app.kind === 'shop') {
    // Guessing one account's password: brute_force_account.
    for (let n = 0; n < 12; n += 1) add(failure(person(5), ATTACKER.guessing));
    // Many accounts from one address: brute_force_ip, credential_stuffing.
    for (let n = 0; n < 24; n += 1) add(failure(person(10 + (n % 12)), ATTACKER.stuffing));
    // A refresh token presented again after its rotation: session_reuse.
    add({
      actor: actorOf(person(7), options.pseudonymKey),
      ...clientOf(app, person(7), 'web'),
      category: 'security',
      action: 'auth.session.reuse_detected',
      outcome: 'success',
      reason: 'refresh_token_reused',
      request: request('POST', '/api/auth/refresh', 401),
    });
    // A known account signs in from a phone it never used: suspicious_sign_in.
    const traveller = person(TRAVELLER);
    add(newPhoneSignIn(app, traveller, options.pseudonymKey));
    // The phone says it is in Mexico City.
    add(sessionStarted(app, traveller, options.pseudonymKey, MEXICO_CITY, at + 1_000));
  }
  if (app.kind === 'backoffice') {
    // The same address against a second application: multi_app_attack.
    for (let n = 0; n < 6; n += 1) add(failure(person(1 + n), ATTACKER.stuffing));
    const admin = {
      actor: actorOf(person(0), options.pseudonymKey),
      ...clientOf(app, person(0), 'web'),
    };
    // A role raised: privilege_change.
    add({
      ...admin,
      category: 'audit',
      action: 'iam.user.role_changed',
      outcome: 'success',
      resource: { type: 'user', id: person(5).id },
      change: { before: { role: 'staff' }, after: { role: 'admin' }, changedFields: ['role'] },
      request: request('PATCH', '/api/users/:id/role', 200),
    });
    // The sales report, six times in a few minutes: mass export.
    for (let n = 0; n < 6; n += 1) {
      add({
        actor: actorOf(person(2), options.pseudonymKey),
        ...clientOf(app, person(2), 'web'),
        category: 'access',
        action: 'reports.sales.exported',
        outcome: 'success',
        request: request('GET', '/api/reports/sales', 200),
        details: { rows: 18_000 + n },
      });
    }
  }
  return events;
}

/** The new phone, as the API records its sign-in (the X-Device-Id header). */
function newPhone(/** @type {DemoApp} */ app) {
  return {
    network: { ip: NEW_PHONE.ip, userAgent: `Tienda/${app.mobileVersion} (Android 15)` },
    client: {
      type: 'android',
      appVersion: app.mobileVersion,
      deviceId: NEW_PHONE.deviceId,
      os: 'Android',
    },
  };
}

/** A sign-in from a phone the account never used, as the API records it. */
function newPhoneSignIn(
  /** @type {DemoApp} */ app,
  /** @type {Person} */ person,
  /** @type {string} */ pseudonymKey,
) {
  return {
    actor: actorOf(person, pseudonymKey),
    ...newPhone(app),
    category: 'security',
    action: 'auth.session.signed_in',
    outcome: 'success',
    request: request('POST', '/api/auth/sign-in', 200),
    details: { method: 'password' },
  };
}

/**
 * The new phone starting its session, where it says it is: the device's own
 * event (the location is the device's, with consent), through the API.
 */
function sessionStarted(
  /** @type {DemoApp} */ app,
  /** @type {Person} */ person,
  /** @type {string} */ pseudonymKey,
  /** @type {{ latitude: number; longitude: number }} */ place,
  /** @type {number} */ at,
) {
  const phone = newPhone(app);
  return {
    actor: actorOf(person, pseudonymKey),
    network: phone.network,
    client: { ...phone.client, sdk: DEVICE_SDK.mobile },
    location: { ...place, accuracyM: 8, capturedAt: new Date(at).toISOString() },
    clientDeclared: ['occurredAt', 'client', 'location'],
    category: 'security',
    action: 'client.session.started',
    outcome: 'success',
  };
}

/**
 * The same phone a minute later, in Madrid: 9,000 km in a minute is
 * impossible travel. Sent after the attacks, once Audit Hub has the first.
 */
export function travelOf(
  /** @type {DemoApp} */ app,
  /** @type {Person[]} */ people,
  /** @type {{ pseudonymKey: string; now: number }} */ options,
) {
  const person = people[TRAVELLER];
  if (app.kind !== 'shop' || app.silent || person === undefined) return [];
  const event = sessionStarted(app, person, options.pseudonymKey, MADRID, options.now);
  return [{ ...event, occurredAt: new Date(options.now).toISOString() }];
}

/** Drafts made events: an id, the next number of the sequence, the catalog version. */
export function numbered(
  /** @type {Draft[]} */ drafts,
  /** @type {{ next: number; catalogVersion: string; skip?: number }} */ sequence,
) {
  return drafts.map((draft) => {
    if (sequence.skip === sequence.next) sequence.next += 1;
    const event = {
      schemaVersion: CONTRACT_VERSION,
      eventId: uuidv7(nodeRandomFill, Date.parse(draft.occurredAt)),
      sourceSeq: sequence.next,
      catalogVersion: sequence.catalogVersion,
      ...draft,
    };
    sequence.next += 1;
    return AuditEventSchema.parse(event);
  });
}

/** Batches of at most 100 events and the contract's byte limit. */
export function batchesOf(/** @type {readonly unknown[]} */ events) {
  /** @type {unknown[][]} */
  const batches = [];
  /** @type {unknown[]} */
  let current = [];
  let bytes = 0;
  for (const event of events) {
    const size = canonicalJsonBytes(event) + 32;
    if (current.length >= LIMITS.batchEvents || bytes + size > LIMITS.batchBytes - 1_024) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(event);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** RFC 6238 (SHA-1, 30 s, 6 digits) of a base32 key, at `at`. */
export function totpCode(/** @type {string} */ secret, /** @type {number} */ at) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  /** @type {number[]} */
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('The key is not base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The API to populate: on this machine only (the seed's credentials are public). */
export function localApi(/** @type {string} */ value) {
  const url = new URL(value);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `The demo signs in with the seed's public credentials: refusing ${url.origin}, which is not on this machine.`,
    );
  }
  return url.origin;
}

/** The development API's address, from apps/api/.env (PORT), else its default. */
function defaultApi() {
  const file = join(ROOT, 'apps/api/.env');
  const port = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')).PORT : undefined;
  return `http://127.0.0.1:${port === undefined || port === '' ? '3200' : port}`;
}

// --- Talking to Audit Hub ------------------------------------------------------

/**
 * @param {string} api
 * @param {string} path
 * @param {{ method?: string; body?: unknown; headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number; data: any; message: string | undefined; retryAfter: number | undefined }>}
 */
async function call(api, path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  /** @type {any} */
  const json = text === '' ? null : JSON.parse(text);
  const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
  return {
    status: response.status,
    data: json?.data,
    message: typeof json?.message === 'string' ? json.message : undefined,
    retryAfter: Number.isInteger(retryAfter) ? retryAfter : undefined,
  };
}

/** The seed's auditor and viewer: they sign in once they see an application. */
const SEED_READERS = ['auditor@example.com', 'viewer@example.com'];
/** AssignAppsSchema: the applications one person may be given at most. */
const MAX_ASSIGNED = 32;

/**
 * Lets the seed's auditor and viewer see the demo's applications, keeping
 * any they had: without one they could not sign in (docs/security.md#who-may-sign-in).
 * @param {string} api
 * @param {Record<string, string>} bearer a stepped-up administrator's
 * @param {string[]} appIds
 */
async function assignSeedReaders(api, bearer, appIds) {
  const users = await call(api, '/api/users?limit=100', { headers: bearer });
  for (const email of SEED_READERS) {
    const user = /** @type {{ id: string; email: string }[]} */ (users.data?.items ?? []).find(
      (candidate) => candidate.email === email,
    );
    if (user === undefined) continue;
    const access = await call(api, `/api/users/${user.id}/access`, { headers: bearer });
    const current = /** @type {{ appId: string }[]} */ (access.data?.apps ?? []).map(
      (app) => app.appId,
    );
    const wanted = [...new Set([...current, ...appIds])];
    if (wanted.length > MAX_ASSIGNED) {
      console.log(`${email} sees ${String(current.length)} applications already: left as is.`);
      continue;
    }
    const saved = await call(api, `/api/users/${user.id}/apps`, {
      method: 'PUT',
      headers: bearer,
      body: { appIds: wanted },
    });
    if (saved.status !== 200) {
      throw new Error(`Assigning ${email}: ${String(saved.status)} ${saved.message ?? ''}`);
    }
    console.log(`${email} sees the demo's applications.`);
  }
}

/** The seed's administrator, signed in with its second factor: a bearer token. */
async function signIn(/** @type {string} */ api) {
  const started = await call(api, '/api/auth/sign-in', {
    method: 'POST',
    body: { email: ADMIN.email, password: ADMIN.password },
  });
  if (started.status !== 200 || started.data?.mfa !== 'verify') {
    throw new Error(
      `Could not sign in as ${ADMIN.email} (${String(started.status)} ${started.message ?? ''}): run \`pnpm db:seed\` first.`,
    );
  }
  // A code is taken once: if this one was just used (someone signed in), the next one.
  for (const offset of [0, 30_000]) {
    if (offset > 0) await sleep(30_000 - (Date.now() % 30_000) + 1_000);
    const verified = await call(api, '/api/auth/mfa/verify', {
      method: 'POST',
      body: {
        challengeToken: started.data.challengeToken,
        code: totpCode(SEED_TOTP_SECRET, Date.now()),
      },
    });
    if (verified.status === 200) return /** @type {string} */ (verified.data.accessToken);
  }
  throw new Error('The second factor was refused twice: try again in a minute.');
}

/**
 * The password and a code again, for the sensitive actions (registering an
 * application): an access token that allows them for five minutes. Each
 * 30-second code is taken once, and the one after the current step is
 * accepted too: that one, so the sign-in's is never presented again.
 */
async function stepUp(/** @type {string} */ api, /** @type {string} */ token) {
  for (const wait of [false, true]) {
    if (wait) await sleep(30_000 - (Date.now() % 30_000) + 1_000);
    const confirmed = await call(api, '/api/account/step-up', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { password: ADMIN.password, code: totpCode(SEED_TOTP_SECRET, Date.now() + 30_000) },
    });
    if (confirmed.status === 200) return /** @type {string} */ (confirmed.data.accessToken);
  }
  throw new Error('Confirming the password and a code was refused twice: try again in a minute.');
}

/** Signs and sends one request as the application's connector does. */
async function signed(
  /** @type {string} */ api,
  /** @type {Record<string, string>} */ variables,
  /** @type {'PUT' | 'POST'} */ method,
  /** @type {string} */ path,
  /** @type {unknown} */ body,
) {
  for (;;) {
    const headers = signRequest({
      keyId: variables.AUDIT_HUB_KEY_ID ?? '',
      key: secretKey(variables.AUDIT_HUB_KEY_SECRET ?? ''),
      method,
      path,
      body,
    });
    const answer = await call(api, path, { method, body, headers });
    if (answer.status === 429 || answer.status === 503) {
      await sleep((answer.retryAfter ?? 5) * 1_000);
      continue;
    }
    if (answer.status !== 200) {
      throw new Error(`${method} ${path}: ${String(answer.status)} ${answer.message ?? ''}`);
    }
    return answer.data;
  }
}

const sleep = (/** @type {number} */ ms) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/**
 * @typedef {object} Connected
 * @property {DemoApp} app
 * @property {string} id
 * @property {Record<string, string>} variables
 * @property {Person[]} people
 * @property {string} instanceId  Its connector's, for the heartbeat.
 * @property {{ epoch: string; next: number; catalogVersion: string; skip?: number }} sequence
 * @property {{ accepted: number; duplicate: number; rejected: number }} counts
 */

/** Sends events in batches; counts what Audit Hub answered, and says why it rejected any. */
async function send(
  /** @type {string} */ api,
  /** @type {Connected} */ app,
  /** @type {Draft[]} */ drafts,
) {
  const events = numbered(drafts, app.sequence);
  for (const batch of batchesOf(events)) {
    const result = await signed(api, app.variables, 'POST', '/api/ingest/events', {
      contractVersion: CONTRACT_VERSION,
      connector: CONNECTOR,
      sequenceEpoch: app.sequence.epoch,
      events: batch,
    });
    for (const item of result.results) {
      if (item.status === 'accepted') app.counts.accepted += 1;
      else if (item.status === 'duplicate') app.counts.duplicate += 1;
      else {
        app.counts.rejected += 1;
        console.warn(
          `  ${app.app.slug}: event #${String(item.index)} rejected (${item.reason ?? 'no reason'})`,
        );
      }
    }
  }
}

async function heartbeat(/** @type {string} */ api, /** @type {Connected} */ app) {
  await signed(api, app.variables, 'POST', '/api/ingest/heartbeat', {
    contractVersion: CONTRACT_VERSION,
    connector: CONNECTOR,
    instanceId: app.instanceId,
    appVersion: app.app.appVersion,
    catalogVersion: app.sequence.catalogVersion,
    sequenceEpoch: app.sequence.epoch,
    lastAssignedSeq: app.sequence.next - 1,
    queue: { size: 0, oldestAgeSeconds: 0, retrying: 0, discardedAtSignOut: 0 },
    responseActions: app.app.kind === 'shop' ? ['revoke_sessions'] : [],
  });
}

/**
 * The history's alerts, reviewed as an auditor would have over the weeks it
 * covers. A person's first sign-in on their second device (the web, then the
 * app) is a new device, rightly: each one was checked with the person and
 * closed. Done before the attacks, so what stays open is what happens now.
 * The real-time rules read in batches every 10 seconds: the open alerts are
 * counted until the count stops growing.
 */
async function reviewHistory(
  /** @type {string} */ api,
  /** @type {Record<string, string>} */ bearer,
  /** @type {Connected[]} */ connected,
) {
  /** @type {{ id: string; version: number }[]} */
  let open = [];
  let unchanged = 0;
  for (let round = 0; round < 30 && unchanged < 3; round += 1) {
    await sleep(10_000);
    /** @type {{ id: string; version: number }[]} */
    const found = [];
    for (const entry of connected) {
      const page = await call(api, `/api/alerts?appId=${entry.id}&status=open&limit=100`, {
        headers: bearer,
      });
      found.push(...(page.data?.items ?? []));
    }
    unchanged = round >= 2 && found.length === open.length ? unchanged + 1 : 0;
    open = found;
  }
  for (const alert of open) {
    const resolved = await call(api, `/api/alerts/${alert.id}`, {
      method: 'PATCH',
      headers: bearer,
      body: { status: 'resolved', version: alert.version },
    });
    const noted = await call(api, `/api/alerts/${alert.id}/notes`, {
      method: 'POST',
      headers: bearer,
      body: { note: 'Checked with the person: they started using our other app (web or mobile).' },
    });
    if (resolved.status !== 200 || noted.status !== 201) {
      throw new Error(
        `Reviewing alert ${alert.id}: ${String(resolved.status)}, ${String(noted.status)} ${noted.message ?? resolved.message ?? ''}`,
      );
    }
  }
  return open.length;
}

async function main() {
  const { values } = parseArgs({
    options: {
      api: { type: 'string' },
      days: { type: 'string', default: '21' },
      suffix: { type: 'string' },
    },
  });
  const api = localApi(values.api ?? defaultApi());
  const days = Number.parseInt(values.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 25) {
    throw new Error('--days: from 1 to 25 (system events are kept 30 days)');
  }
  const suffix = values.suffix === undefined ? '' : `-${values.suffix}`;
  const apps = DEMO_APPS.map((app) => ({ ...app, slug: `${app.slug}${suffix}` }));

  const ready = await call(api, '/api/health/ready').catch(() => undefined);
  if (ready?.status !== 200)
    throw new Error(`Audit Hub does not answer at ${api}: start it with \`pnpm dev\`.`);

  const bearer = { Authorization: `Bearer ${await stepUp(api, await signIn(api))}` };
  const existing = await call(api, '/api/connected-apps', { headers: bearer });
  const taken = apps.filter((app) =>
    /** @type {{ slug: string }[]} */ (existing.data ?? []).some((row) => row.slug === app.slug),
  );
  if (taken.length > 0) {
    // Only the seed's auditor and viewer may lack them (a database seeded
    // again, or a demo from before they needed an application to sign in).
    await assignSeedReaders(
      api,
      bearer,
      /** @type {{ id: string; slug: string }[]} */ (existing.data ?? [])
        .filter((row) => taken.some((app) => app.slug === row.slug))
        .map((row) => row.id),
    );
    console.log(
      `The demo is there already (${taken.map((app) => app.slug).join(', ')}): nothing else changed. Another set: pnpm dev:demo --suffix 2`,
    );
    return;
  }

  const now = Date.now();
  /** @type {Connected[]} */
  const connected = [];
  for (const [index, app] of apps.entries()) {
    const created = await call(api, '/api/connected-apps', {
      method: 'POST',
      headers: bearer,
      body: { slug: app.slug, name: app.name, environment: app.environment },
    });
    if (created.status !== 201) {
      throw new Error(
        `Registering ${app.slug}: ${String(created.status)} ${created.message ?? ''}`,
      );
    }
    const id = /** @type {string} */ (created.data.app.id);
    // One address failing on several applications is correlated only where enabled.
    if (app.correlated) {
      const updated = await call(api, `/api/connected-apps/${id}`, {
        method: 'PATCH',
        headers: bearer,
        body: { correlationEnabled: true },
      });
      if (updated.status !== 200) {
        throw new Error(
          `Enabling correlation on ${app.slug}: ${String(updated.status)} ${updated.message ?? ''}`,
        );
      }
    }
    const catalog = CatalogDocumentSchema.parse(catalogOf(app));
    const variables = /** @type {Record<string, string>} */ (created.data.credentials.variables);
    const published = await signed(api, variables, 'PUT', '/api/ingest/catalog', {
      contractVersion: CONTRACT_VERSION,
      catalog,
    });
    connected.push({
      app,
      id,
      variables,
      people: peopleOf(app, 20_261_016 + index),
      instanceId: randomUUID(),
      sequence: {
        epoch: uuidv7(nodeRandomFill),
        next: 1,
        catalogVersion: /** @type {string} */ (published.version),
      },
      counts: { accepted: 0, duplicate: 0, rejected: 0 },
    });
    console.log(
      `Registered ${app.name} (${app.environment}, ${app.slug}) and published its catalog.`,
    );
  }

  // While the step-up is recent: assigning applications needs one.
  await assignSeedReaders(
    api,
    bearer,
    connected.map((entry) => entry.id),
  );

  for (const [index, entry] of connected.entries()) {
    const pseudonymKey = entry.variables.AUDIT_HUB_PSEUDONYM_KEY ?? '';
    const history = historyOf(entry.app, entry.people, {
      pseudonymKey,
      now,
      days,
      seed: 7 + index,
    });
    await send(api, entry, history);
    console.log(
      `${entry.app.slug}: ${String(history.length)} events of ${String(days)} days sent.`,
    );
  }

  console.log('Waiting for the real-time rules to read the history...');
  const reviewed = await reviewHistory(api, bearer, connected);
  console.log(
    `Reviewed the ${String(reviewed)} alerts the history raised (people's second devices).`,
  );

  for (const entry of connected) {
    const pseudonymKey = entry.variables.AUDIT_HUB_PSEUDONYM_KEY ?? '';
    if (entry.app.silent) {
      // Its API went down: one event its queue numbered never left it (a gap),
      // the next one did, and no heartbeat since.
      entry.sequence.skip = entry.sequence.next;
      const person = entry.people[0];
      if (person !== undefined) {
        await send(api, entry, [
          {
            actor: actorOf(person, pseudonymKey),
            ...clientOf(entry.app, person, 'web'),
            category: 'security',
            action: 'auth.session.signed_out',
            outcome: 'success',
            request: request('POST', '/api/auth/logout', 204),
            occurredAt: new Date(Date.now() - 20 * MINUTE_MS).toISOString(),
          },
        ]);
      }
      continue;
    }
    await send(api, entry, attacksOf(entry.app, entry.people, { pseudonymKey, now: Date.now() }));
    await heartbeat(api, entry);
  }
  console.log('Attacks sent. The phone reports from far away in a minute (impossible travel)...');
  await sleep(65_000);
  for (const entry of connected) {
    const pseudonymKey = entry.variables.AUDIT_HUB_PSEUDONYM_KEY ?? '';
    const travel = travelOf(entry.app, entry.people, { pseudonymKey, now: Date.now() });
    if (travel.length > 0) {
      await send(api, entry, travel);
      await heartbeat(api, entry);
    }
  }

  console.log('');
  for (const entry of connected) {
    const { accepted, duplicate, rejected } = entry.counts;
    const label = `${entry.app.name} (${entry.app.environment})`;
    console.log(
      `${label.padEnd(24)} ${String(accepted).padStart(5)} accepted, ${String(duplicate)} duplicate, ${String(rejected)} rejected`,
    );
  }
  console.log(
    [
      '',
      'Open Audit Hub (pnpm dev: http://localhost:5273) as admin@example.com:',
      '  Overview  the three applications and their heartbeats; staging is silent, with a gap',
      '  Events    weeks of activity; filter by application, client (web, iOS, Android), action',
      '  Security  failed sign-ins by day, the addresses behind them',
      '  Alerts    session reuse, a role raised and a suspicious sign-in (a new phone, then',
      '            impossible travel) now; brute force, credential stuffing, an attack on two',
      '            applications and a mass export within five minutes (the periodic rules)',
    ].join('\n'),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {unknown} */ error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
