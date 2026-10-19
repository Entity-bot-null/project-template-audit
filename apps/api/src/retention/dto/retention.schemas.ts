import { ID_PATTERN, RESOURCE_TYPE_PATTERN } from 'audit-contract';
import { z } from 'zod';

export const RETENTION_CLASS_VALUES = [
  'security',
  'audit',
  'access',
  'system',
  'audit_access',
  'personal',
  'location',
] as const;

export const RetentionPolicySchema = z.object({
  class: z.enum(RETENTION_CLASS_VALUES),
  /** What the database enforces whatever the setting. */
  minimumDays: z.int(),
  /** In effect: the setting, never below the minimum. */
  days: z.int(),
  /** Set for this application (false: the minimum). */
  custom: z.boolean(),
});
export type RetentionPolicyResponse = z.infer<typeof RetentionPolicySchema>;

export const SetRetentionPolicySchema = z.object({
  days: z.int().min(1).max(3650),
});
export type SetRetentionPolicyDto = z.infer<typeof SetRetentionPolicySchema>;

export const CreateLegalHoldSchema = z
  .object({
    appId: z.uuid(),
    caseRef: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(10).max(500),
    actorId: z.string().regex(ID_PATTERN).optional(),
    /** Matched by its pseudonym; the address itself is never stored. */
    actorEmail: z.string().trim().max(254).pipe(z.email()).optional(),
    resourceType: z.string().regex(RESOURCE_TYPE_PATTERN).optional(),
    resourceId: z.string().regex(ID_PATTERN).optional(),
    fromAt: z.iso.datetime().optional(),
    toAt: z.iso.datetime().optional(),
  })
  .refine(
    (hold) =>
      [hold.actorId, hold.actorEmail, hold.resourceId, hold.fromAt, hold.toAt].some(
        (criterion) => criterion !== undefined,
      ),
    'name what the hold keeps: a subject, an email, a resource or a period',
  )
  .refine((hold) => hold.resourceId === undefined || hold.resourceType !== undefined, {
    message: 'a resource id needs its type',
    path: ['resourceType'],
  })
  .refine(
    (hold) =>
      hold.fromAt === undefined ||
      hold.toAt === undefined ||
      // As instants: the strings may carry a different number of fractional digits.
      Date.parse(hold.fromAt) < Date.parse(hold.toAt),
    { message: 'must be after fromAt', path: ['toAt'] },
  );
export type CreateLegalHoldDto = z.infer<typeof CreateLegalHoldSchema>;

export const ReleaseLegalHoldSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

export const LegalHoldSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  caseRef: z.string(),
  reason: z.string(),
  actorId: z.string().nullable(),
  /** The hold matches an email (stored only as its pseudonym). */
  byEmail: z.boolean(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  fromAt: z.iso.datetime().nullable(),
  toAt: z.iso.datetime().nullable(),
  createdById: z.uuid(),
  createdAt: z.iso.datetime(),
  release: z
    .object({ reason: z.string(), releasedById: z.uuid(), releasedAt: z.iso.datetime() })
    .nullable(),
});
export type LegalHoldResponse = z.infer<typeof LegalHoldSchema>;
