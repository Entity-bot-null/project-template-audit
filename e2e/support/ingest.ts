import type { APIRequestContext } from '@playwright/test';
import { canonicalQuery, uuidv7 } from '../../packages/audit-contract/dist/index.js';
import {
  nodeRandomFill,
  secretKey,
  signRequest,
} from '../../packages/audit-contract/dist/node/index.js';

// An application sending its audit log to the suite's Audit Hub, signed with
// the variables the admin pages showed when it was registered, as a
// connector does (docs/design/audit-hub/contract.md).

export interface Credentials {
  AUDIT_HUB_KEY_ID: string;
  AUDIT_HUB_KEY_SECRET: string;
}

/** The NAME=value lines the admin pages show once. */
export function credentialsOf(text: string): Credentials {
  const values = new Map(
    text
      .split('\n')
      .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
      .filter((match) => match !== null)
      .map((match) => [match[1] ?? '', match[2] ?? ''] as const),
  );
  const keyId = values.get('AUDIT_HUB_KEY_ID');
  const keySecret = values.get('AUDIT_HUB_KEY_SECRET');
  if (keyId === undefined || keySecret === undefined) throw new Error('No signing key shown');
  return { AUDIT_HUB_KEY_ID: keyId, AUDIT_HUB_KEY_SECRET: keySecret };
}

export async function sendSigned(
  api: APIRequestContext,
  credentials: Credentials,
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
): Promise<unknown> {
  const headers = signRequest({
    keyId: credentials.AUDIT_HUB_KEY_ID,
    key: secretKey(credentials.AUDIT_HUB_KEY_SECRET),
    method,
    path,
    query: canonicalQuery(new URLSearchParams()),
    body,
  });
  const response = await api.fetch(path, { method, headers, data: body });
  if (!response.ok())
    throw new Error(`${method} ${path}: ${String(response.status())} ${await response.text()}`);
  return response.json();
}

/** Publishes the catalog, then sends the events; answers nothing, throws on a refusal. */
export async function ingest(
  api: APIRequestContext,
  credentials: Credentials,
  catalog: Record<string, unknown>,
  events: Record<string, unknown>[],
): Promise<void> {
  const published = (await sendSigned(api, credentials, 'PUT', '/api/ingest/catalog', {
    contractVersion: 1,
    catalog,
  })) as { data: { version: string } };
  await sendSigned(api, credentials, 'POST', '/api/ingest/events', {
    contractVersion: 1,
    connector: { name: 'audit-nestjs', version: '0.1.0' },
    sequenceEpoch: uuidv7(nodeRandomFill),
    events: events.map((event, index) => ({
      schemaVersion: 1,
      eventId: uuidv7(nodeRandomFill),
      sourceSeq: index + 1,
      occurredAt: new Date().toISOString(),
      catalogVersion: published.data.version,
      ...event,
    })),
  });
}
