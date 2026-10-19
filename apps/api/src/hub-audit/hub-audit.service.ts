import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type AuditEvent,
  clientHintsFromHeaders,
  type JsonValue,
  normalizeAuditEvent,
  uuidv7,
} from 'audit-contract';
import { nodeRandomFill } from 'audit-contract/node';
import type { Request } from 'express';
import { clientIp } from '../common/logging/request-context.middleware.js';
import { errorSummary } from '../common/logging/error-summary.js';
import { ConnectedAppsService, SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { buildRows, contentHashOf } from '../ingest/event-rows.js';
import { currentRequestId } from '../observability/request-context.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HUB_ACTIONS, type HubActionName } from './hub-actions.js';

/** Who did it: a person of Audit Hub, or a connected application (its connector API). */
export type HubActor =
  | { type: 'user'; id: string; role: string }
  | { type: 'service'; id: string }
  | { type: 'anonymous' };

export interface HubEventInput {
  action: HubActionName;
  actor: HubActor;
  outcome?: AuditEvent['outcome'];
  resource?: { type: string; id: string };
  details?: Record<string, JsonValue>;
  change?: { before?: Record<string, JsonValue>; after?: Record<string, JsonValue> };
  reason?: string;
  /** The HTTP request it happened in: method, route, the caller's IP and user agent. */
  request?: Request;
}

const CONNECTOR = { name: 'audit-hub', version: '0.1.0' };
const HUB_CATALOG_VERSION = '0000000000000000';
const json = (value: unknown) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

// Audit Hub's own audit trail (docs/design/audit-hub): its people's sign-ins,
// their changes, and what they looked at (searches, details, exports), as
// events of the system application, built and hashed exactly like an
// application's (event-rows.ts), sealed in their own streams (audit_access
// has its own chain) and kept by the same retention. No sequence: Audit Hub
// writes them itself, in a transaction of their own with the timeout the
// database requires.
@Injectable()
export class HubAuditService {
  private readonly logger = new Logger('HubAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly apps: ConnectedAppsService,
    // The browser, system, device class and place of the request, as an
    // application's events get them at ingest. Absent in the CLIs, whose
    // records have no request.
    @Optional() private readonly enrichment?: EnrichmentService,
  ) {}

  /** Records one event; answers its id (audit_events.id). Throws when it cannot be stored. */
  async record(input: HubEventInput): Promise<string> {
    try {
      return await this.write(input);
    } catch (error) {
      // The system application's row comes back after a database was emptied
      // (the test suites, a restore without it): once, then the write again.
      if (!isMissingSystemApp(error)) throw error;
      await this.apps.ensureSystemApp();
      return this.write(input);
    }
  }

  /** For records that must not fail what was already done (a change committed): logs instead. */
  async recordQuietly(input: HubEventInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error(`Could not record ${input.action}: ${errorSummary(error)}`);
    }
  }

  private async write(input: HubEventInput): Promise<string> {
    const entry = HUB_ACTIONS[input.action];
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL transaction_timeout = '10s'`;
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT date_trunc('milliseconds', now()) AS "now"`;
      const recordedAt = clock?.now ?? new Date();
      // The same normalization as an application's events: text sanitized,
      // oversized values cut, malformed optional fields dropped.
      const normalized = normalizeAuditEvent(
        toEvent(input, entry.spec.category, recordedAt),
        recordedAt.getTime(),
      );
      if (normalized.status === 'rejected') {
        throw new Error(
          `${input.action} is not a valid event: ${normalized.reason} (${normalized.paths.join(', ')})`,
        );
      }
      const built = buildRows({
        event: normalized.event,
        spec: entry.spec,
        ...(this.enrichment === undefined
          ? {}
          : { enrichment: this.enrichment.enrich(normalized.event) }),
        envelope: {
          appId: SYSTEM_APP_ID,
          sequenceEpoch: SYSTEM_APP_ID,
          connectorName: CONNECTOR.name,
          connectorVersion: CONNECTOR.version,
          catalogVersionId: SYSTEM_APP_ID,
        },
        recordedAt,
        truncatedFields: normalized.truncatedFields,
        droppedFields: normalized.droppedFields,
        flags: normalized.flags,
      });
      if (built.status === 'rejected') {
        throw new Error(
          `${input.action} does not follow its spec: ${built.reason} (${built.paths.join(', ')})`,
        );
      }
      // Audit Hub's own: no sequence, no published catalog, its own stream.
      const row = {
        ...built.event,
        sequenceEpoch: null,
        sourceSeq: null,
        catalogVersionId: null,
        category: entry.category,
      };
      row.contentHash = contentHashOf(row);
      await tx.auditEvent.create({
        data: {
          ...row,
          changeBefore: json(row.changeBefore),
          changeAfter: json(row.changeAfter),
          details: json(row.details),
        },
      });
      if (built.personal !== null) {
        await tx.eventPersonal.create({
          data: {
            ...built.personal,
            personalChange: json(built.personal.personalChange),
            clientHints: json(built.personal.clientHints),
          },
        });
      }
      return row.id;
    });
  }
}

function toEvent(input: HubEventInput, category: AuditEvent['category'], at: Date): AuditEvent {
  const request = input.request;
  const userAgent = request?.get('User-Agent');
  // What the panel's browser says of itself beyond its user agent (the page
  // asks for the full hints in Accept-CH: apps/web/nginx/security-headers.conf).
  const clientHints =
    request === undefined ? undefined : clientHintsFromHeaders((name) => request.get(name));
  const ip = request === undefined ? undefined : clientIp(request);
  const route = (request?.route as { path?: unknown } | undefined)?.path;
  const requestId = currentRequestId();
  return {
    schemaVersion: 1,
    eventId: uuidv7(nodeRandomFill, at.getTime()),
    sourceSeq: 1,
    occurredAt: at.toISOString(),
    // Its catalog is in code (hub-actions.ts): a version of zeros, never published.
    catalogVersion: HUB_CATALOG_VERSION,
    category,
    action: input.action,
    outcome: input.outcome ?? 'success',
    actor:
      input.actor.type === 'user'
        ? { type: 'user', id: input.actor.id, role: input.actor.role }
        : input.actor.type === 'service'
          ? { type: 'service', id: input.actor.id }
          : { type: 'anonymous' },
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.change === undefined ? {} : { change: input.change }),
    ...(request === undefined
      ? {}
      : {
          request: {
            ...(requestId === undefined ? {} : { requestId }),
            method: request.method,
            ...(typeof route === 'string' ? { route: route.slice(0, 256) } : {}),
          },
          network: {
            ...(ip === undefined || ip === 'unknown' ? {} : { ip }),
            ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, 512) }),
            ...(clientHints === undefined ? {} : { clientHints }),
          },
        }),
  } as AuditEvent;
}

function isMissingSystemApp(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003' &&
    JSON.stringify(error.meta ?? {}).includes('app_id')
  );
}
