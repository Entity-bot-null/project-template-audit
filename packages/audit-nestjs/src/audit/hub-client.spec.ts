import { describe, expect, it } from 'vitest';
import { CONNECTOR } from './audit.constants.js';
import type { HubRequest } from './audit.ports.js';
import { FakeTransport, ok, TEST_CONFIG } from './audit.testing.js';
import { catalogDocument } from './catalog/catalog.js';
import {
  type AuditEvent,
  bodyDigest,
  canonicalQuery,
  CONTRACT_VERSION,
  type Heartbeat,
  NONCE_PATTERN,
  parseSignatureHeader,
  SIGNATURE_HEADERS,
  type SignedParts,
  secretKey,
  verifySignature,
} from './contract/index.js';
import { buildEvent } from './event-builder.js';
import { envelopeData, HubClient } from './hub-client.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const KEY = secretKey(TEST_CONFIG.keySecret);
const EPOCH = '0199e0b1-0000-7000-8000-0000000000e1';

function connected() {
  const transport = new FakeTransport(() => ok({ received: true }));
  return { transport, client: new HubClient(TEST_CONFIG, transport, () => NOW) };
}

/** The request as Audit Hub checks it: the signed parts rebuilt from what arrived. */
function signedParts(request: HubRequest): SignedParts {
  const header = (name: string) => request.headers[name] ?? '';
  return {
    method: request.method,
    path: request.path,
    query: canonicalQuery(Object.entries(request.query ?? {})),
    timestamp: Number(header(SIGNATURE_HEADERS.timestamp)),
    nonce: header(SIGNATURE_HEADERS.nonce),
    keyId: header(SIGNATURE_HEADERS.keyId),
    bodyDigest: bodyDigest(request.body),
  };
}

function expectSigned(request: HubRequest | undefined): HubRequest {
  if (request === undefined) throw new Error('nothing was sent');
  const signatures = parseSignatureHeader(request.headers[SIGNATURE_HEADERS.signature]);
  expect(signatures).toHaveLength(1);
  expect(verifySignature([KEY], signedParts(request), signatures)).toBe(true);
  expect(request.headers[SIGNATURE_HEADERS.keyId]).toBe(TEST_CONFIG.keyId);
  expect(request.headers[SIGNATURE_HEADERS.timestamp]).toBe(String(NOW / 1000));
  expect(request.headers[SIGNATURE_HEADERS.nonce]).toMatch(NONCE_PATTERN);
  expect(request.headers[SIGNATURE_HEADERS.bodyDigest]).toBe(bodyDigest(request.body));
  expect(request.headers['User-Agent']).toBe(`audit-nestjs/${CONNECTOR.version}`);
  return request;
}

const heartbeat: Heartbeat = {
  contractVersion: CONTRACT_VERSION,
  connector: CONNECTOR,
  instanceId: '0199e0b1-0000-7000-8000-0000000000f1',
  appVersion: TEST_CONFIG.appVersion,
  catalogVersion: '0123456789abcdef',
  sequenceEpoch: EPOCH,
  lastAssignedSeq: 4,
  queue: { size: 0, oldestAgeSeconds: 0, retrying: 0, discardedAtSignOut: 0 },
  responseActions: ['revoke_sessions'],
};

describe('HubClient', () => {
  it('sends a batch of events, signed', async () => {
    const { transport, client } = connected();
    const event: AuditEvent = {
      ...buildEvent({ action: 'auth.session.signed_out' }, undefined, {
        catalogVersion: '0123456789abcdef',
        pseudonymKey: TEST_CONFIG.pseudonymKey,
        now: NOW,
      }),
      sourceSeq: 1,
    };
    await expect(client.sendEvents(EPOCH, [event])).resolves.toEqual(ok({ received: true }));
    const request = expectSigned(transport.requests[0]);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/api/ingest/events');
    expect(request.body).toEqual({
      contractVersion: CONTRACT_VERSION,
      connector: { name: 'audit-nestjs', version: CONNECTOR.version },
      sequenceEpoch: EPOCH,
      events: [event],
    });
    expect(request).not.toHaveProperty('query');
  });

  it('publishes the catalog, signed', async () => {
    const { transport, client } = connected();
    const catalog = catalogDocument('shop', '0.1.0', ['revoke_sessions']);
    await client.publishCatalog(catalog);
    const request = expectSigned(transport.requests[0]);
    expect(request.method).toBe('PUT');
    expect(request.path).toBe('/api/ingest/catalog');
    expect(request.body).toEqual({ contractVersion: CONTRACT_VERSION, catalog });
  });

  it('sends a heartbeat, signed', async () => {
    const { transport, client } = connected();
    await client.heartbeat(heartbeat);
    const request = expectSigned(transport.requests[0]);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/api/ingest/heartbeat');
    expect(request.body).toEqual(heartbeat);
  });

  it('asks for the activity of a user, signed with its query', async () => {
    const { transport, client } = connected();
    await client.activity('user-1', { cursor: 'next page', limit: 20 });
    const request = expectSigned(transport.requests[0]);
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/api/connector/subjects/user-1/activity');
    expect(request.query).toEqual({ cursor: 'next page', limit: '20' });
    expect(request).not.toHaveProperty('body');
  });

  it('encodes the subject in the path, and sends no query when there is none', async () => {
    const { transport, client } = connected();
    await client.activity('a:b/c', {});
    await client.activity('user-1', { limit: 5 });
    await client.activity('user-1', { cursor: 'abc' });
    const [bare, limited, paged] = transport.requests.map(expectSigned);
    expect(bare?.path).toBe('/api/connector/subjects/a%3Ab%2Fc/activity');
    expect(bare).not.toHaveProperty('query');
    expect(limited?.query).toEqual({ limit: '5' });
    expect(paged?.query).toEqual({ cursor: 'abc' });
  });

  it('asks for the erasure of a user, signed over its scope', async () => {
    const { transport, client } = connected();
    await client.erase('a:b/c', 'events');
    const request = expectSigned(transport.requests[0]);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/api/connector/subjects/a%3Ab%2Fc/erasure');
    expect(request.body).toEqual({ scope: 'events' });
    expect(request).not.toHaveProperty('query');
  });

  it('signs each request with a fresh nonce', async () => {
    const { transport, client } = connected();
    await client.heartbeat(heartbeat);
    await client.heartbeat(heartbeat);
    const [first, second] = transport.requests;
    expect(first?.headers[SIGNATURE_HEADERS.nonce]).not.toBe(
      second?.headers[SIGNATURE_HEADERS.nonce],
    );
  });

  it('answers what the transport answers', async () => {
    const transport = new FakeTransport(() => ({ status: 503, retryAfterSec: 30, body: null }));
    const client = new HubClient(TEST_CONFIG, transport, () => NOW);
    await expect(client.heartbeat(heartbeat)).resolves.toEqual({
      status: 503,
      retryAfterSec: 30,
      body: null,
    });
  });

  it('sends nothing while the connector is off', () => {
    const transport = new FakeTransport(() => ok(null));
    const client = new HubClient(null, transport, () => NOW);
    expect(() => client.heartbeat(heartbeat)).toThrow('The Audit Hub connector is off');
    expect(() => client.publishCatalog(catalogDocument('shop', '0.1.0', []))).toThrow(
      'The Audit Hub connector is off',
    );
    expect(() => client.sendEvents(EPOCH, [])).toThrow('The Audit Hub connector is off');
    expect(() => client.activity('user-1', {})).toThrow('The Audit Hub connector is off');
    expect(transport.requests).toHaveLength(0);
  });
});

describe('envelopeData', () => {
  it('is the data of a success envelope', () => {
    expect(envelopeData(ok({ lastContiguousSeq: 3 }))).toEqual({ lastContiguousSeq: 3 });
    expect(envelopeData({ status: 200, body: { data: null } })).toBeNull();
  });

  it('is undefined for anything else', () => {
    expect(envelopeData({ status: 200, body: 'ok' })).toBeUndefined();
    expect(envelopeData({ status: 200, body: 42 })).toBeUndefined();
    expect(envelopeData({ status: 204, body: null })).toBeUndefined();
    expect(envelopeData({ status: 204, body: undefined })).toBeUndefined();
    expect(envelopeData({ status: 400, body: { message: 'Bad request' } })).toBeUndefined();
  });
});
