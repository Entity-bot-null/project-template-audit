import { z } from 'zod';

export const StreamStatusSchema = z.object({
  appId: z.uuid(),
  slug: z.string(),
  category: z.string(),
  lastSealNo: z.string().nullable(),
  sealedThrough: z.iso.datetime().nullable(),
  unsealedEvents: z.int(),
});

export const VerificationSchema = z.object({
  id: z.uuid(),
  trigger: z.string(),
  outcome: z.enum(['passed', 'failed', 'error']),
  sealsChecked: z.int(),
  eventsChecked: z.string(),
  failures: z.int(),
  /** Ids only: kind, application, category, seal number, event. */
  failureSample: z.array(z.record(z.string(), z.string())).nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
});

export const IntegrityStatusSchema = z.object({
  streams: z.array(StreamStatusSchema),
  verifications: z.array(VerificationSchema),
  lastCheckpoint: z
    .object({ id: z.uuid(), digest: z.string(), createdAt: z.iso.datetime() })
    .nullable(),
});
export type IntegrityStatus = z.infer<typeof IntegrityStatusSchema>;
