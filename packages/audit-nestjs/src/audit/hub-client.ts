import { Inject, Injectable } from '@nestjs/common';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CLOCK,
  AUDIT_CONFIG,
  AUDIT_TRANSPORT,
  CONNECTOR,
  CONTRACT_VERSION,
} from './audit.constants.js';
import type { AuditTransport, HubResponse } from './audit.ports.js';
import {
  type AuditEvent,
  type CatalogDocument,
  canonicalQuery,
  type ErasureScope,
  type Heartbeat,
  secretKey,
  signRequest,
} from './contract/index.js';

/**
 * Audit Hub's API for applications (docs/design/audit-hub/contract.md):
 * every request signed with the application's key, over the project's
 * transport (createExternalHttpClient: timeouts, metrics, logs).
 */
@Injectable()
export class HubClient {
  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_TRANSPORT) private readonly transport: AuditTransport,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
  ) {}

  sendEvents(sequenceEpoch: string, events: AuditEvent[]): Promise<HubResponse> {
    return this.signed('POST', '/api/ingest/events', {
      contractVersion: CONTRACT_VERSION,
      connector: CONNECTOR,
      sequenceEpoch,
      events,
    });
  }

  publishCatalog(catalog: CatalogDocument): Promise<HubResponse> {
    return this.signed('PUT', '/api/ingest/catalog', {
      contractVersion: CONTRACT_VERSION,
      catalog,
    });
  }

  heartbeat(heartbeat: Heartbeat): Promise<HubResponse> {
    return this.signed('POST', '/api/ingest/heartbeat', heartbeat);
  }

  /** "My account's security" of one user: catalog actions marked user-visible, no IP. */
  activity(subject: string, query: { cursor?: string; limit?: number }): Promise<HubResponse> {
    const params: Record<string, string> = {};
    if (query.cursor !== undefined) params.cursor = query.cursor;
    if (query.limit !== undefined) params.limit = String(query.limit);
    return this.signed(
      'GET',
      `/api/connector/subjects/${encodeURIComponent(subject)}/activity`,
      undefined,
      params,
    );
  }

  /** The right to erasure of one user: their personal data, or their events too (scope). */
  erase(subject: string, scope: ErasureScope): Promise<HubResponse> {
    return this.signed('POST', `/api/connector/subjects/${encodeURIComponent(subject)}/erasure`, {
      scope,
    });
  }

  private signed(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<HubResponse> {
    const config = this.requireConfig();
    const headers = signRequest({
      keyId: config.keyId,
      key: secretKey(config.keySecret),
      method,
      path,
      query: canonicalQuery(Object.entries(query)),
      body,
      now: this.clock(),
    });
    return this.transport.send({
      method,
      path,
      ...(Object.keys(query).length === 0 ? {} : { query }),
      ...(body === undefined ? {} : { body }),
      headers: { ...headers, 'User-Agent': `${CONNECTOR.name}/${CONNECTOR.version}` },
    });
  }

  private requireConfig(): AuditConfig {
    if (this.config === null) throw new Error('The Audit Hub connector is off');
    return this.config;
  }
}

/** The `data` of a success envelope ({ data, message }); undefined for anything else. */
export function envelopeData(response: HubResponse): unknown {
  const body = response.body;
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined;
  return body.data;
}
