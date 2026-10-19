import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { type AuditEvent, type CatalogDocument, canonicalQuery, uuidv7 } from 'audit-contract';
import { nodeRandomFill, secretKey, signRequest } from 'audit-contract/node';
import request from 'supertest';
import { ConnectedAppsService } from '../src/connected-apps/connected-apps.service.js';

// A connected application as the suites drive it: registered through the
// service (as an admin would), then calling the ingestion API with requests
// signed exactly as a connector signs them.

export interface TestConnectedApp {
  id: string;
  slug: string;
  keyId: string;
  keySecret: string;
  pseudonymKey: string;
  webhookSecret: string;
}

export async function registerApp(
  app: INestApplication,
  slug = 'my-project',
  options: { webhookUrl?: string } = {},
): Promise<TestConnectedApp> {
  const created = await app
    .get(ConnectedAppsService)
    .create('0199e0b1-0000-7000-8000-00000000000a', {
      slug,
      name: `App ${slug}`,
      environment: 'production',
      ...options,
    });
  const variables = created.credentials.variables;
  const value = (name: string) => {
    const found = variables[name];
    if (found === undefined) throw new Error(`no ${name} in the credentials`);
    return found;
  };
  return {
    id: created.app.id,
    slug,
    keyId: value('AUDIT_HUB_KEY_ID'),
    keySecret: value('AUDIT_HUB_KEY_SECRET'),
    pseudonymKey: value('AUDIT_HUB_PSEUDONYM_KEY'),
    webhookSecret: value('AUDIT_HUB_WEBHOOK_SECRET'),
  };
}

export interface SignOptions {
  now?: number;
  nonce?: string;
  keyId?: string;
  keySecret?: string;
  /** Sign this body but send another one. */
  sentBody?: unknown;
}

/** A request signed with the application's key, as the NestJS connector sends it. */
export function signed(
  server: Server,
  connected: TestConnectedApp,
  method: 'POST' | 'PUT' | 'GET',
  path: string,
  body?: unknown,
  options: SignOptions = {},
) {
  const [pathname = path, search = ''] = path.split('?');
  const headers = signRequest({
    keyId: options.keyId ?? connected.keyId,
    key: secretKey(options.keySecret ?? connected.keySecret),
    method,
    path: pathname,
    query: canonicalQuery(new URLSearchParams(search)),
    body: method === 'GET' ? undefined : body,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
  const agent = request(server);
  const call =
    method === 'POST' ? agent.post(path) : method === 'PUT' ? agent.put(path) : agent.get(path);
  call.set(headers);
  return method === 'GET' ? call : call.send((options.sentBody ?? body) as object);
}

export const CONNECTOR = { name: 'audit-nestjs', version: '0.1.0' };
export const EPOCH = '0199e0b1-0000-7000-8000-0000000000e1';

/** A catalog with the actions the suites use. */
export function testCatalog(overrides: Partial<CatalogDocument> = {}): CatalogDocument {
  return {
    catalogFormat: 1,
    app: { name: 'my-project', version: '1.0.0' },
    actions: {
      'auth.session.signed_in': {
        category: 'security',
        severity: 'info',
        description: 'A user signed in.',
        source: 'server',
        tags: ['auth.sign_in'],
        userVisible: true,
        details: { fields: { method: { type: 'enum', values: ['password'] } } },
      },
      'account.profile.updated': {
        category: 'audit',
        severity: 'low',
        description: 'A user changed their profile.',
        source: 'server',
        change: {
          fields: {
            name: { type: 'string', personal: true },
            password: { type: 'string', sensitive: true },
          },
        },
      },
      'client.session.expired': {
        category: 'security',
        severity: 'low',
        description: 'The app found its session expired.',
        source: 'client',
      },
    },
    ...overrides,
  };
}

/** Publishes the catalog and answers its version. */
export async function publishCatalog(
  server: Server,
  connected: TestConnectedApp,
  catalog: CatalogDocument = testCatalog(),
): Promise<string> {
  const res = await signed(server, connected, 'PUT', '/api/ingest/catalog', {
    contractVersion: 1,
    catalog,
  }).expect(200);
  return (res.body as { data: { version: string } }).data.version;
}

/** A valid event of the test catalog. */
export function testEvent(
  catalogVersion: string,
  sourceSeq: number,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    schemaVersion: 1,
    eventId: uuidv7(nodeRandomFill),
    sourceSeq,
    occurredAt: new Date().toISOString(),
    catalogVersion,
    category: 'security',
    action: 'auth.session.signed_in',
    outcome: 'success',
    actor: { type: 'user', id: 'user-1', role: 'member', label: 'j***@e***.com' },
    request: { requestId: 'req-1', method: 'POST', route: '/api/auth/sign-in', status: 200 },
    network: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
    details: { method: 'password' },
    ...overrides,
  };
}

export function batch(events: unknown[], sequenceEpoch = EPOCH) {
  return { contractVersion: 1, connector: CONNECTOR, sequenceEpoch, events };
}
