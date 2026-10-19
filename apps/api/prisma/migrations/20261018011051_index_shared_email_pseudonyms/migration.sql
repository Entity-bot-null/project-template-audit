-- The same person across applications (a subject's view with other
-- applications, explorer/blocked.ts) is found by the shared email pseudonym,
-- which no index had: each lookup read every event of the applications
-- searched. A large table: built without blocking ingestion, in a migration
-- of its own (CONCURRENTLY cannot run inside a transaction).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_email_shared_idx"
  ON "audit_events" ("actor_email_hmac_shared", "app_id")
  WHERE "actor_email_hmac_shared" IS NOT NULL;
