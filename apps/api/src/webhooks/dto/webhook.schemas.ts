import { z } from 'zod';
import { pageOf } from '../../common/pagination.js';

export const WebhookDeliverySchema = z.object({
  id: z.uuid(),
  target: z.enum(['app', 'slack', 'teams']),
  type: z.string(),
  status: z.enum(['pending', 'sending', 'delivered', 'failed', 'expired']),
  attempts: z.int(),
  /** The HTTP status of the last attempt, when there was an answer. */
  lastStatus: z.int().nullable(),
  /** Why the last attempt failed (a category, never a response body). */
  lastError: z.string().nullable(),
  nextAttemptAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type WebhookDeliveryResponse = z.infer<typeof WebhookDeliverySchema>;

export const WebhookDeliveryPageSchema = pageOf(WebhookDeliverySchema);

export const QueuedWebhookSchema = z.object({ id: z.uuid() });
