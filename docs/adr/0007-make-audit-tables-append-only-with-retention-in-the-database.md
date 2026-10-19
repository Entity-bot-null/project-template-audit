# 0007. Make audit tables append-only in the database, and delete only through retention functions

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

The module this replaces let administrators edit and delete log records. Its "daily" cleanup was
never scheduled, and its manual delete was not validated on the server. Audit records must not
change after they are written, and they must go only when their retention period ends, unless a
legal hold keeps them.

Minimum retention in days: security 730, audit 365, access 180, system 30, audit_access 730;
network and device data 90; device coordinates 30. Each application may extend these but never
go below them. Data subjects can ask for erasure, and some events must be kept anyway.

What the template gives us:

- `app_runtime` holds `SELECT, INSERT, UPDATE, DELETE` on every table, including future ones
  (`ALTER DEFAULT PRIVILEGES` in `roles.sql`, which is run again on every password rotation).
- Development and the test suites connect as the owner.
- The integration suites empty every table with `TRUNCATE … CASCADE`.

## Options

1. **Application discipline only:** no code path updates or deletes. This is exactly what failed
   before: one admin screen or one SQL console is enough to break it.
2. **Revoke privileges only.** That stops the API role, but re-running `roles.sql` grants them
   back without anyone noticing, and the owner (development, tests, migrations) is unaffected.
3. **A trigger only.** It stops every role, but the owner can disable it, and on its own it
   doesn't explain who is allowed to delete for retention.
4. **Revoke + a trigger + `SECURITY DEFINER` functions as the only path for deletes, and a boot
   check.**
   - The trigger refuses every UPDATE and DELETE. The only exception is a DELETE run as the
     table's owner while a transaction-local flag is set, which only the retention functions set.
   - The functions belong to the migration role. They enforce the minimums, the application's
     policy, the legal holds and the "sealed only" rule, and they record every run.
   - The runtime role may only execute them.
5. **An external WORM store** (S3 Object Lock). It is real immutability outside the database, but
   it needs object storage and makes queries harder. It fits the optional archive, not the
   working store.

## Decision

Option 4, with option 5 kept for the optional archive.

- **Append-only tables:**
  - `audit_events`, `event_personal`, `event_locations`;
  - `catalog_versions`, `catalog_actions`;
  - `integrity_seals`, `integrity_seal_leaves`, `integrity_checkpoints`, `integrity_verifications`;
  - `retention_runs`, `retention_run_seals`;
  - `legal_holds`, `legal_hold_releases` (a hold is released by a new row);
  - `erasure_runs`, `ingest_exceptions`, `alert_activities`.

  Operational state stays mutable and holds no audit record: alerts' current state, deliveries,
  nonces, sequence state, rule state.

- **Trigger `audit_forbid_mutation()`:** it rejects UPDATE always. It rejects DELETE unless
  `current_user` is the table's owner and `audit.maintenance` is set for the transaction, which
  only the functions do. TRUNCATE is not blocked, as the brief asks; `app_runtime` has no
  TRUNCATE privilege (`roles.sql`).
- **Privileges in one function:** `audit_apply_runtime_privileges(role)` revokes UPDATE, DELETE
  and TRUNCATE on those tables and grants EXECUTE on the functions. Three places call it:
  - the migration;
  - `roles.sql`, after its blanket GRANT;
  - the integration setup, which creates `app_runtime` with the same grants as production so the
    specs can `SET ROLE app_runtime` and prove that UPDATE and DELETE fail.
- **Boot check:** the API checks its own role at boot. In production, a role that can update or
  delete `audit_events` logs an error, sets the gauge `app_database_privileges_ok` to 0 and fires
  the critical alert `AuditHubDatabasePrivilegesTooBroad`.
- **Retention:**
  - `audit_retention_min_days(class)` is an IMMUTABLE SQL function. It holds the minimums, and the
    CHECK on `retention_policies` uses it too.
  - `audit_purge(app, class, cutoff)` raises an error for any cutoff inside
    `max(minimum, policy)`. It deletes only events inside a sealed window (ADR 0008) and nothing
    that a legal hold matches. It works in batches of 5,000 under an advisory lock, and it records
    `retention_runs` plus the per-seal deleted counts that integrity verification needs.
  - Satellite rows (`personal`, `location`) go first; the events of the core classes after.
- **Erasure:** `audit_erase_subject(app, subject, via, scope)` deletes the subject's satellite rows
  and what the rules derived of them (`actor_devices`, `actor_countries`, `actor_profiles`), except
  what a legal hold matches, and records an `erasure_runs` row. With scope `personal` the event
  itself stays, pseudonymized: an app's user id, an HMAC of the email, no label, no IP, no device.
  The legal basis (keeping security records, Art. 17(3)(b) and (e) GDPR; LFPDPPP art. 25) goes in
  docs/security.md and in the DPIA template. The subject is then blocked in the per-person reads
  for what occurred up to the erasure (LFPDPPP art. 24, docs/security.md). An event of before that
  arrives later loses its satellite rows when the rules read it (`audit_erase_late(event)`).
- **Deleting events, besides retention:** `audit_delete_events(app, erasure_run, limit)` is the only
  other function that deletes events. With scope `events` (the controller cancelled the
  subject's data) it deletes the subject's sealed events; with no erasure run, every event of a
  suspended application (the end of its service), after which `audit_finish_application_deletion`
  deletes what was derived from them and the application is retired. It never deletes what a
  legal hold matches or an unsealed event, records `retention_runs` (trigger `subject` or
  `decommission`) with the per-seal counts like `audit_purge`, deletes the leaves of seals left
  empty (their digests and counts stay), and runs one application at a time under an advisory
  lock, waiting for it at most 5 seconds.
- **Satellite digests:** the event stores `SHA-256(salt ‖ canonical row)` of each satellite row,
  and the random salt lives in that row. While the row exists, the digest proves it is unchanged.
  Once it is deleted, the digest cannot be tested against guessed IPs or devices. This is
  crypto-shredding without a key per row.
- **Scheduling:** a daily sweep using the template's pattern (`setInterval().unref()` started at
  bootstrap and `LockService.withLock('jobs:retention', …)`). Without Redis, `LockService` only
  coordinates one process, so the function's advisory lock is what makes concurrent instances
  safe. Every run writes a `job_runs` row, and
  `app_job_last_success_timestamp_seconds{job="retention"}` feeds `AuditHubRetentionSweepMissing`
  after 26 hours.

## Consequences

- "Delete this record" exists nowhere in the UI or the API. Asked to remove something, an admin
  can only change the retention policy (never below the minimum; the change is itself recorded in
  `audit_access`), answer an erasure request (a subject's personal data, or all their events), or
  end a suspended application's service (its whole log). Each goes through its function and is
  recorded per seal, so the verification tells it apart from tampering.
- `roles.sql`, the guide in docs/deploy-vps.md section 5 and the restore steps in
  docs/disaster-recovery.md must call `audit_apply_runtime_privileges('app_runtime')` after
  granting. A restore that forgets it is caught by the boot check.
- Whoever owns the database (the migration role, a superuser) can still disable the trigger. That
  is what integrity sealing exists for: such a change becomes detectable without the integrity
  key, which never lives in the database (ADR 0008).
- `check-migrations.mjs` doesn't read SQL inside function bodies. The functions are reviewed as
  SQL, and their integration specs pin the behavior: cutoff refused below the minimum, holds
  respected, unsealed events never purged, the runtime role refused.
- We would know this was wrong if the purge could not keep up with the volume (then partition by
  month and drop whole partitions, a later ADR), or if legitimate corrections kept being needed
  (then they are new events that supersede old ones, never edits).
