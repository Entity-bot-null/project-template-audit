// The connector's view of this project (docs/audit/connection-guide.md):
// everything it uses of the API template, in one place. Created by
// `pnpm connector add` and never overwritten by an update: if this project
// moved one of these, point the export at its new place here.
export { Auth } from '../auth/auth.decorator.js';
export { CurrentUser } from '../common/decorators/current-user.decorator.js';
export { RouteRateLimit } from '../common/guards/rate-limit.guard.js';
export { clientIp } from '../common/logging/request-context.middleware.js';
export { ApiData, ApiErrors, ZodBody, ZodQuery } from '../common/openapi/index.js';
export type { RequestUser } from '../common/types/request-user.js';
export { correlationIds } from '../observability/request-context.js';

import type { Prisma } from '../prisma/generated/client.js';

/** A transaction of this project's Prisma client: AuditService.record(tx, ...) takes it. */
export type AuditTx = Prisma.TransactionClient;
