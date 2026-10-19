import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeEmail } from '../auth/auth.constants.js';
import { secretBoxFromConfig } from '../common/crypto/secret-box.js';
import { ConnectedAppsService } from '../connected-apps/connected-apps.service.js';
import { env } from '../env/env.js';
import { HubAuditService } from '../hub-audit/hub-audit.service.js';
import { PrismaClient } from '../prisma/generated/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The way back when nobody can reset a second factor from the admin pages
// (the last administrator lost their phone and their recovery codes, or
// AUDIT_SECRETS_KEY was lost): run on the server like user:create
// (docs/adr/0012). The person sets up a new factor at their next sign-in;
// every session of theirs ends. The reason is recorded in Audit Hub's own log
// (hub.mfa.reset), like a reset from the admin pages.
//   pnpm --filter api user:reset-mfa --email <email> --reason "<why>"
//   docker compose ... run --rm -T api node dist/users/reset-mfa.cli.js --email <email> --reason "<why>"
const USAGE = 'Usage: user:reset-mfa --email <email> --reason "<why, 10 to 500 characters>"';
const { values } = parseArgs({
  options: { email: { type: 'string' }, reason: { type: 'string' } },
});

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const reason = values.reason?.trim() ?? '';
  if (values.email === undefined || reason.length < 10 || reason.length > 500) {
    throw new Error(USAGE);
  }
  const email = normalizeEmail(values.email);
  const user = await prisma.$transaction(async (tx) => {
    const found = await tx.user.findUnique({
      where: { email },
      select: { id: true, removedAt: true },
    });
    if (found === null) throw new Error(`No account ${email}.`);
    if (found.removedAt !== null) throw new Error(`The account ${email} was removed.`);
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
    await tx.mfaFactor.deleteMany({ where: { userId: found.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: found.id } });
    await tx.user.update({ where: { id: found.id }, data: { securityVersion: { increment: 1 } } });
    await tx.session.updateMany({
      where: { userId: found.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return found;
  });
  const { box } = secretBoxFromConfig({
    secret: env.AUDIT_SECRETS_KEY,
    previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  });
  const service = prisma as unknown as PrismaService;
  await new HubAuditService(service, new ConnectedAppsService(service, box)).record({
    action: 'hub.mfa.reset',
    actor: { type: 'service', id: 'user-reset-mfa-cli' },
    resource: { type: 'user', id: user.id },
    details: { reason },
  });
  console.log(
    `The second factor of ${email} (${user.id}) was reset: they set up a new one at their next sign-in.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
