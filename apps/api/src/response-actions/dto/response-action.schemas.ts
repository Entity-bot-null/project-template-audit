import { ID_PATTERN, RESPONSE_ACTIONS } from 'audit-contract';
import { z } from 'zod';
import { pageOf } from '../../common/pagination.js';

export const RESPONSE_ACTION_STATUSES = [
  'pending_approval',
  'dispatched',
  'succeeded',
  'failed',
  'refused',
  'unsupported',
  'expired',
  'cancelled',
] as const;

export const CreateResponseActionSchema = z.object({
  appId: z.uuid(),
  /** The application's user id. */
  subject: z.string().regex(ID_PATTERN),
  action: z.enum(RESPONSE_ACTIONS),
  /** Why: kept with the request, sent to the application. */
  reason: z.string().trim().min(10).max(500),
  /** The alert that led to it, if any (same application). */
  alertId: z.uuid().optional(),
});
export type CreateResponseActionDto = z.infer<typeof CreateResponseActionSchema>;

export const ResponseActionListQuerySchema = z.object({
  appId: z.uuid().optional(),
  status: z.enum(RESPONSE_ACTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ResponseActionListQuery = z.infer<typeof ResponseActionListQuerySchema>;

export const ResponseActionSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  subject: z.string(),
  action: z.enum(RESPONSE_ACTIONS),
  reason: z.string(),
  status: z.enum(RESPONSE_ACTION_STATUSES),
  alertId: z.uuid().nullable(),
  requestedById: z.uuid(),
  approvedById: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ResponseActionResponse = z.infer<typeof ResponseActionSchema>;

export const ResponseActionPageSchema = pageOf(ResponseActionSchema);
