import {
  type Actor,
  AuditEventDraftSchema,
  type AuditEventDraft,
  type Change,
  type ClientInfo,
  CONTRACT_VERSION,
  compileFields,
  emailHmac,
  type JsonValue,
  LIMITS,
  maskEmail,
  maskPhone,
  type Outcome,
  type RequestInfo,
  type Resource,
  secretKey,
  type Severity,
  toWellFormed,
  uuidv7,
  nodeRandomFill,
} from './contract/index.js';
import { type Actions, actionSpec, type AuditAction } from './catalog/catalog.js';
import type { AuditScope } from './request-scope.js';

/**
 * Who acted: a signed-in user is taken from the request when not given. A
 * person's `name` is their label in Audit Hub (else their email, masked);
 * their `email` and `phone` never leave the application in clear: the email
 * as its pseudonym, the phone as its last four digits (•••• 1234).
 */
export type ActorInput =
  | { type: 'user'; id: string; role?: string; email?: string; name?: string; phone?: string }
  | { type: 'anonymous'; email?: string; name?: string; phone?: string }
  | { type: 'system'; id?: string }
  | { type: 'service'; id?: string };

/** What the project records: everything else comes from the request and the catalog. */
export interface AuditInput {
  action: AuditAction;
  /** Default: success. */
  outcome?: Outcome;
  /** Default: the catalog's. */
  severity?: Severity;
  /** A code for a failure or a denial: invalid_credentials, rate_limited… */
  reason?: string;
  actor?: ActorInput;
  resource?: Resource;
  /** From AuditService.change(action, before, after). */
  change?: Change;
  details?: Record<string, JsonValue>;
  /** The status the response will carry, when the event is about it. */
  status?: number;
  occurredAt?: Date;
}

/** An event the contract or the catalog refuses: a bug of the call, caught by its tests. */
export class AuditEventInvalidError extends Error {
  constructor(
    readonly action: string,
    readonly problems: string[],
  ) {
    super(`Audit event ${action} is invalid: ${problems.join('; ')}`);
    this.name = 'AuditEventInvalidError';
  }
}

export interface BuildContext {
  /** The catalog version the event is written against (re-stamped when it is sent). */
  catalogVersion: string;
  /** base64url key that turns emails into pseudonyms. */
  pseudonymKey: string;
  now: number;
  /** The catalog: this project's by default; a spec passes its own. */
  actions?: Actions;
}

/** The queued form of an event: validated against the contract and the action's catalog entry. */
export function buildEvent(
  input: AuditInput,
  scope: AuditScope | undefined,
  context: BuildContext,
): AuditEventDraft {
  const spec = actionSpec(input.action, context.actions);
  if (spec === undefined) {
    throw new AuditEventInvalidError(input.action, ['the action is not in the catalog']);
  }
  const problems: string[] = [];
  const outcome = input.outcome ?? 'success';
  if (spec.outcomes !== undefined && !spec.outcomes.includes(outcome)) {
    problems.push(`outcome ${outcome} is not one of ${spec.outcomes.join(', ')}`);
  }
  if (spec.source === 'client')
    problems.push('a client action comes from a device, not the server');
  if (input.details !== undefined) {
    const fields = spec.details?.fields ?? {};
    const result = compileFields(fields).safeParse(input.details);
    if (!result.success)
      problems.push(
        ...result.error.issues.map(
          (i) => `${['details', ...i.path.map(String)].join('.')}: ${i.message}`,
        ),
      );
  }
  if (input.change !== undefined && spec.change === undefined) {
    problems.push('the action declares no change in the catalog');
  }

  const draft = {
    schemaVersion: CONTRACT_VERSION,
    eventId: uuidv7(nodeRandomFill, context.now),
    occurredAt: (input.occurredAt ?? new Date(context.now)).toISOString(),
    catalogVersion: context.catalogVersion,
    category: spec.category,
    action: input.action,
    outcome,
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    actor: actorOf(input.actor, scope, context.pseudonymKey),
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.change === undefined ? {} : { change: input.change }),
    ...requestPart(scope, input.status),
    ...networkPart(scope),
    ...clientPart(scope),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
  const parsed = AuditEventDraftSchema.safeParse(draft);
  if (!parsed.success) {
    problems.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  if (problems.length > 0 || !parsed.success)
    throw new AuditEventInvalidError(input.action, problems);
  return parsed.data;
}

/** The actor: the given one, else the request's signed-in user, else anonymous. */
export function actorOf(
  input: ActorInput | undefined,
  scope: AuditScope | undefined,
  pseudonymKey: string,
): Actor {
  const given: ActorInput =
    input ??
    (scope?.user === undefined
      ? { type: 'anonymous' }
      : { type: 'user', id: scope.user.id, role: scope.user.role });
  const email = 'email' in given && given.email !== undefined ? given.email : undefined;
  const name =
    'name' in given && given.name !== undefined
      ? toWellFormed(given.name).trim().slice(0, LIMITS.label)
      : '';
  const phone = 'phone' in given && given.phone !== undefined ? maskPhone(given.phone) : undefined;
  const pseudonym = {
    ...(email === undefined ? {} : { emailHmac: emailHmac(secretKey(pseudonymKey), email) }),
    ...(name !== '' ? { label: name } : email === undefined ? {} : { label: maskEmail(email) }),
    ...(phone === undefined ? {} : { phoneLabel: phone }),
  };
  switch (given.type) {
    case 'user':
      return {
        type: 'user',
        id: given.id,
        ...(given.role === undefined ? {} : { role: given.role }),
        ...pseudonym,
      };
    case 'anonymous':
      return { type: 'anonymous', ...pseudonym };
    case 'system':
    case 'service':
      return { type: given.type, ...(given.id === undefined ? {} : { id: given.id }) };
  }
}

function requestPart(scope: AuditScope | undefined, status: number | undefined) {
  const request: RequestInfo = {
    ...(scope?.requestId === undefined ? {} : { requestId: scope.requestId }),
    ...(scope?.traceId === undefined ? {} : { traceId: scope.traceId }),
    ...(scope?.method === undefined ? {} : { method: scope.method }),
    ...(scope?.route === undefined ? {} : { route: scope.route }),
    ...(status === undefined ? {} : { status }),
  };
  return Object.keys(request).length === 0 ? {} : { request };
}

function networkPart(scope: AuditScope | undefined) {
  if (
    scope?.ip === undefined &&
    scope?.userAgent === undefined &&
    scope?.clientHints === undefined
  ) {
    return {};
  }
  return {
    network: {
      ...(scope.ip === undefined ? {} : { ip: scope.ip }),
      ...(scope.userAgent === undefined ? {} : { userAgent: scope.userAgent }),
      ...(scope.clientHints === undefined ? {} : { clientHints: scope.clientHints }),
    },
  };
}

function clientPart(scope: AuditScope | undefined): { client?: ClientInfo } {
  return scope?.client === undefined ? {} : { client: scope.client };
}
