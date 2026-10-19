import { execSync } from 'node:child_process';
import pg from 'pg';
import { testDatabaseUrl } from './db-url.js';

// Runs once before the integration suites: creates `<db>_test` when missing
// and brings it to the current schema with the committed migrations, the
// same way a deployment does (`prisma migrate deploy`).
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const database = decodeURIComponent(url.pathname.slice(1));

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach PostgreSQL at ${url.host} (${reason}). Start it with \`pnpm db:up\`, or point DATABASE_URL at a server.`,
      { cause: error },
    );
  }
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'inherit',
  });

  // The API's production role, with what roles.sql grants it and what the
  // migration takes back (docs/adr/0007), so specs can SET ROLE app_runtime
  // and see what the API itself may do. Roles are per server: an existing one
  // is reused. It cannot log in (no password): only SET ROLE reaches it.
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN;
      END IF;
    END $$`);
    await db.query('GRANT USAGE ON SCHEMA public TO app_runtime');
    await db.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime',
    );
    await db.query("SELECT audit_apply_runtime_privileges('app_runtime')");
  } finally {
    await db.end();
  }
}
