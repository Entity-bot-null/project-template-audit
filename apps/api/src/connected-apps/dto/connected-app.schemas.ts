import { APP_SLUG_PATTERN, RESPONSE_ACTIONS } from 'audit-contract';
import { z } from 'zod';

// Connected applications as administrators manage them. Secrets appear only
// in the answer that creates them (CredentialsSchema), never afterwards.

// The signature names the path only (contract.md#webhooks): no query string,
// no fragment, no credentials in the URL. https is required in production
// when the webhook is sent (http works locally and in tests).
const webhookUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  }, 'no query string, fragment or credentials');

export const CreateConnectedAppSchema = z.object({
  /** Short id: metric label, URLs, webhook signatures. Never changes. */
  slug: z.string().regex(APP_SLUG_PATTERN),
  name: z.string().trim().min(1).max(100),
  /** production, staging, …: each environment is an application of its own. */
  environment: z.string().regex(/^[a-z][a-z0-9-]{0,15}$/),
  /** Where webhooks go: the application's POST /api/audit/webhooks. */
  webhookUrl: webhookUrl.optional(),
});
export type CreateConnectedAppDto = z.infer<typeof CreateConnectedAppSchema>;

export const UpdateConnectedAppSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    webhookUrl: webhookUrl.nullable(),
    status: z.enum(['active', 'suspended']),
    heartbeatTimeoutSec: z.int().min(60).max(86_400),
    rateLimitPerMinute: z.int().min(1).max(10_000),
    correlationEnabled: z.boolean(),
    acceptedResponseActions: z.array(z.enum(RESPONSE_ACTIONS)).max(RESPONSE_ACTIONS.length),
    requireActionApproval: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to change');
export type UpdateConnectedAppDto = z.infer<typeof UpdateConnectedAppSchema>;

export const AppKeySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  /** Set when a newer key replaced it: valid until then. */
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
});

export const ConnectedAppSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  environment: z.string(),
  status: z.enum(['active', 'suspended', 'retired']),
  webhookUrl: z.string().nullable(),
  correlationEnabled: z.boolean(),
  acceptedResponseActions: z.array(z.enum(RESPONSE_ACTIONS)),
  requireActionApproval: z.boolean(),
  heartbeatTimeoutSec: z.int(),
  rateLimitPerMinute: z.int(),
  createdAt: z.iso.datetime(),
  keys: z.array(AppKeySchema),
});
export type ConnectedAppResponse = z.infer<typeof ConnectedAppSchema>;

/** The end of an application's service: its slug, typed again. */
export const DeleteConnectedAppLogSchema = z.strictObject({ confirm: z.string().min(1).max(64) });
export type DeleteConnectedAppLogDto = z.infer<typeof DeleteConnectedAppLogSchema>;

export const APP_DELETION_STATES = ['deleting', 'waiting', 'held', 'deleted'] as const;

/**
 * Where the deletion of an application's log got to: deleting (more to
 * delete: call again), waiting (events not sealed yet: in 2 minutes), held (a
 * legal hold keeps events or names the application), deleted (retired).
 */
export const AppDeletionProgressSchema = z.object({
  status: z.enum(APP_DELETION_STATES),
  /** Events deleted by this call. */
  deleted: z.int().min(0),
  /** Events a legal hold keeps. */
  held: z.int().min(0),
  /** Events waiting for their seal. */
  waiting: z.int().min(0),
});
export type AppDeletionProgress = z.infer<typeof AppDeletionProgressSchema>;

/** Shown once: Audit Hub keeps only ciphertexts. */
export const CredentialsSchema = z.object({
  /** The variables to paste into the application's environment (docs/audit/connection-guide.md). */
  variables: z.record(z.string(), z.string()),
});
export type CredentialsResponse = z.infer<typeof CredentialsSchema>;

export const CreatedConnectedAppSchema = z.object({
  app: ConnectedAppSchema,
  credentials: CredentialsSchema,
});
export type CreatedConnectedAppResponse = z.infer<typeof CreatedConnectedAppSchema>;
