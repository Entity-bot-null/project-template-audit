import { z } from 'zod';
import { APP_SLUG_PATTERN, RESPONSE_ACTIONS, type ResponseAction } from './contract/index.js';

// The connector's variables (docs/audit/connection-guide.md), declared in the
// project's own env schema, src/env/env.schema.ts:
//
//   export const EnvSchema = z
//     .object({ ...the project's variables..., ...AUDIT_ENV_SHAPE })
//     .superRefine((values, ctx) => { ...; checkAuditEnv(values, ctx); })
//
// Unset (the default), the connector is off: nothing is queued, its routes
// answer 404, the boot is unaffected. This file imports nothing of the
// project, so env.schema.ts can import it without a cycle.

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** 32 random bytes or more as base64url: what Audit Hub shows once. */
const secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,128}$/, 'must be the base64url secret Audit Hub showed');

const responseActions = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.enum(RESPONSE_ACTIONS)).max(RESPONSE_ACTIONS.length));

export const AUDIT_ENV_SHAPE = {
  /** Audit Hub's public origin, e.g. https://audit.example.com. */
  AUDIT_HUB_URL: optional(z.url({ protocol: /^https?$/ })),
  /** This application's slug in Audit Hub. */
  AUDIT_HUB_APP: optional(z.string().regex(APP_SLUG_PATTERN)),
  /** The signing key: its id and secret. */
  AUDIT_HUB_KEY_ID: optional(z.uuid()),
  AUDIT_HUB_KEY_SECRET: optional(secret),
  /** Turns emails into pseudonyms (HMAC) before they leave the project. */
  AUDIT_HUB_PSEUDONYM_KEY: optional(secret),
  /** Verifies Audit Hub's webhooks; the previous one during a rotation. */
  AUDIT_HUB_WEBHOOK_SECRET: optional(secret),
  AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS: optional(secret),
  /** The response actions this project runs when Audit Hub asks (comma-separated). */
  AUDIT_HUB_RESPONSE_ACTIONS: responseActions,
  /** "Was it you?" pushed to the user's phones: `expo` (the push module), unset for none. */
  AUDIT_HUB_PUSH: optional(z.enum(['expo'])),
  /** Expo's access token, when the project's push security requires one. */
  AUDIT_HUB_EXPO_ACCESS_TOKEN: optional(z.string().regex(/^[\x21-\x7e]{1,512}$/)),
  /** Queued events above which the queue is reported as backed up. */
  AUDIT_HUB_QUEUE_ALERT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(100).max(10_000_000).default(10_000),
  ),
};

export type AuditEnv = z.infer<z.ZodObject<typeof AUDIT_ENV_SHAPE>>;

/** What the connector reads of the project's environment. */
export type AuditEnvInput = AuditEnv & { NODE_ENV: string; APP_RELEASE?: string | undefined };

const REQUIRED = [
  'AUDIT_HUB_URL',
  'AUDIT_HUB_APP',
  'AUDIT_HUB_KEY_ID',
  'AUDIT_HUB_KEY_SECRET',
  'AUDIT_HUB_PSEUDONYM_KEY',
] as const;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The rules between the variables: all of the connection or none, https in production. */
export function checkAuditEnv(values: AuditEnvInput, ctx: z.RefinementCtx): void {
  const set = REQUIRED.filter((name) => values[name] !== undefined);
  if (set.length > 0 && set.length < REQUIRED.length) {
    for (const name of REQUIRED) {
      if (values[name] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `required with ${set.join(', ')}: the connector needs every one of ${REQUIRED.join(', ')}`,
        });
      }
    }
  }
  const url = values.AUDIT_HUB_URL;
  if (url !== undefined && new URL(url).origin !== url.replace(/\/+$/, '')) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIT_HUB_URL'],
      message: 'must be an origin (scheme://host[:port]): requests are signed with their path',
    });
  }
  if (
    values.NODE_ENV === 'production' &&
    url?.startsWith('http:') === true &&
    !LOOPBACK.has(new URL(url).hostname)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIT_HUB_URL'],
      message: 'must be https in production',
    });
  }
  if (
    values.AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS !== undefined &&
    values.AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS === values.AUDIT_HUB_WEBHOOK_SECRET
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS'],
      message: 'must differ from AUDIT_HUB_WEBHOOK_SECRET',
    });
  }
  if (values.AUDIT_HUB_EXPO_ACCESS_TOKEN !== undefined && values.AUDIT_HUB_PUSH === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIT_HUB_EXPO_ACCESS_TOKEN'],
      message: 'requires AUDIT_HUB_PUSH=expo',
    });
  }
  // Each needs the webhooks: Audit Hub asks for response actions through them,
  // and the "Was it you?" the push module pushes arrives by one.
  for (const name of [
    'AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS',
    'AUDIT_HUB_RESPONSE_ACTIONS',
    'AUDIT_HUB_PUSH',
  ] as const) {
    const given =
      name === 'AUDIT_HUB_RESPONSE_ACTIONS' ? values[name].length > 0 : values[name] !== undefined;
    if (given && values.AUDIT_HUB_WEBHOOK_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [name],
        message: 'requires AUDIT_HUB_WEBHOOK_SECRET: Audit Hub asks through signed webhooks',
      });
    }
  }
}

/** The connector's settings; null when it is off. */
export interface AuditConfig {
  hubUrl: string;
  app: string;
  keyId: string;
  keySecret: string;
  pseudonymKey: string;
  /** The current secret first, then the previous one during a rotation. */
  webhookSecrets: string[];
  responseActions: ResponseAction[];
  queueAlert: number;
  /** The project's release as the heartbeat reports it. */
  appVersion: string;
  /** The push module: off (null), or Expo's push service. */
  push: { provider: 'expo'; accessToken: string | undefined } | null;
}

const VERSION_TOKEN = /^[A-Za-z0-9.+_-]{1,32}$/;

export function auditConfigFromEnv(env: AuditEnvInput): AuditConfig | null {
  const {
    AUDIT_HUB_URL: hubUrl,
    AUDIT_HUB_APP: app,
    AUDIT_HUB_KEY_ID: keyId,
    AUDIT_HUB_KEY_SECRET: keySecret,
    AUDIT_HUB_PSEUDONYM_KEY: pseudonymKey,
  } = env;
  if (
    hubUrl === undefined ||
    app === undefined ||
    keyId === undefined ||
    keySecret === undefined ||
    pseudonymKey === undefined
  ) {
    return null;
  }
  // A release id longer than the contract's token (a full commit SHA) is cut.
  const release = (env.APP_RELEASE ?? 'unversioned').slice(0, 32);
  return {
    hubUrl: hubUrl.replace(/\/+$/, ''),
    app,
    keyId,
    keySecret,
    pseudonymKey,
    webhookSecrets: [env.AUDIT_HUB_WEBHOOK_SECRET, env.AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS].filter(
      (value): value is string => value !== undefined,
    ),
    responseActions: env.AUDIT_HUB_RESPONSE_ACTIONS,
    queueAlert: env.AUDIT_HUB_QUEUE_ALERT,
    appVersion: VERSION_TOKEN.test(release) ? release : 'unversioned',
    push:
      env.AUDIT_HUB_PUSH === 'expo'
        ? { provider: 'expo', accessToken: env.AUDIT_HUB_EXPO_ACCESS_TOKEN }
        : null,
  };
}
