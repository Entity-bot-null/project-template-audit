import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../env/env.js';
import { secretBoxFromConfig } from '../common/crypto/secret-box.js';
import { PrismaClient } from '../prisma/generated/client.js';
import { SEED_TOTP_SECRET, SEED_USERS, seed } from './seed.js';

// `pnpm db:seed`: development data for a local database. The accounts it
// creates have public passwords, so it refuses production, and any database
// outside this machine unless told otherwise (a disposable remote database:
// `pnpm db:seed --allow-remote-database`).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

if (env.NODE_ENV === 'production') {
  console.error('The seed creates accounts with public passwords: refusing NODE_ENV=production.');
  process.exit(1);
}
// The driver also takes hosts from the query string (?host=, ?hostaddr=),
// and those win over the URL's: every one of them must be local.
const url = new URL(env.DATABASE_URL);
const hosts = [
  url.hostname,
  ...['host', 'hostaddr'].flatMap((key) => url.searchParams.getAll(key)),
];
const remote = hosts.filter((host) => !LOCAL_HOSTS.has(host));
if (remote.length > 0 && !process.argv.includes('--allow-remote-database')) {
  console.error(
    `The seed creates accounts with public passwords: refusing the database at "${remote.join(', ')}", which is not on this machine. Pass --allow-remote-database if it is disposable.`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const { box } = secretBoxFromConfig({
    secret: env.AUDIT_SECRETS_KEY,
    previous: env.AUDIT_SECRETS_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  });
  await seed(prisma, box);
  console.log(
    [
      'Seeded:',
      ...SEED_USERS.map((u) => `  ${u.role.padEnd(7)} ${u.email} / ${u.password}`),
      `Second factor of every account (authenticator app, "enter a key"): ${SEED_TOTP_SECRET}`,
    ].join('\n'),
  );
} finally {
  await prisma.$disconnect();
}
