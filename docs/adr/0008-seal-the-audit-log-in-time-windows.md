# 0008. Seal the audit log in signed, hash-chained time windows per application and category

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

Append-only storage (ADR 0007) stops the API role. It cannot stop someone who owns the database:
a migration role, a superuser, a restored and edited backup. Such a person can disable a trigger
and then edit, delete or insert events. Audit Hub must make that detectable. `audit verify` must
fail and name the event.

The design has to cope with several things:

- **Transactions that commit late.** An ingest transaction that started earlier can commit after
  a later one, so "everything up to now" is never final at the moment it is read.
- **Retention**, which legitimately deletes events from the middle of the history, category by
  category, with legal-hold exceptions.
- **Rotation** of the signing key.
- **Restores**, logical (pg_dump) or point-in-time.
- **Throughput:** ingestion must not serialize on a global lock.

## Options

1. **A per-event hash chain written at insert time** (`prev_hash` of the previous event). Every
   insert of an application would serialize on the chain head (a lock per app per insert).
   Retention breaks the chain wherever a category is deleted between two survivors.
2. **Seal by transaction-id watermark:** store `pg_current_xact_id()` in each event and seal
   everything below `pg_snapshot_xmin(pg_current_snapshot())`. This is exact with respect to late
   commits, but a logical restore resets transaction ids. New events can then sort below sealed
   ones and never get sealed, and recovering from that is subtle.
3. **Seal time windows behind a database-enforced horizon.**
   - The database sets `recorded_at` (`now()`, the transaction's start).
   - A trigger refuses any insert from a transaction whose `transaction_timeout` is not set
     between 1 ms and 15 s (PostgreSQL 17+). So no transaction that could still insert into a
     window commits more than 15 s after that window.
   - The sealer closes `[previous windowTo, now() − 2 min)`.
   - It is robust across restores (it is about time) and needs no lock on the insert path.
4. **An external transparency log or a blockchain anchor.** It gives the strongest
   non-repudiation, but adds an external dependency and a cost per anchor. The daily checkpoint of
   option 3 can be anchored by hand or by the optional archive instead.

## Decision

Option 3.

- **Streams:** one chain per `(application, category)`. Retention works per category, so a
  stream's deletions are its own. `audit_access` (Audit Hub's own use) is a stream of the system
  application.
- **Content hash:** at ingest, `content_hash = SHA-256(canonical JSON)` of every stored column of
  the event, including `recorded_at`, the enrichment and the satellite digests.
  - The canonical JSON follows RFC 8785 for the types we store.
  - The column list is fixed in `packages/audit-contract` as `canonicalEventForHash`, and the
    verifier recomputes it from the database columns, not from the original request.
  - Timestamps are truncated to milliseconds before hashing, as the database keeps them.
- **Seal:** each sealer run creates, for each stream that has events in its window, one row in
  `integrity_seals` (append-only). The seal holds:
  - `sealNo` (gapless per stream);
  - `[windowFrom, windowTo)`, where `windowFrom` is the previous seal's `windowTo`, so the windows
    tile the timeline and an empty stretch is simply inside the next window;
  - `eventCount` and `leavesDigest = SHA-256(leaves)`;
  - `prevHash`;
  - `sealHash = SHA-256("seal-v1" ‖ prevHash ‖ app ‖ category ‖ sealNo ‖ windowFrom ‖ windowTo ‖ eventCount ‖ leavesDigest)`;
  - `signature = HMAC-SHA256(AUDIT_INTEGRITY_KEY, sealHash)`, with the key's fingerprint.

  The leaves are `(event pk, content_hash)` pairs ordered by `(recorded_at, id)`, stored in
  `integrity_seal_leaves`.

- **Checkpoints:** once a day, a signed digest over every stream's head (`sealNo`, `sealHash`).
  `pnpm --filter api audit export --checkpoint` prints it so it can be kept outside Audit Hub: in
  an email to the security contact, a ticket, or the optional archive.
- **Verification** (`audit verify`, and a daily job over the seals created since the last good
  verification; `--full` checks everything):
  1. The seal chain links and every `sealNo` is present.
  2. Signatures check. A seal signed with a key that is no longer configured is accepted only if
     a later checkpoint or seal, signed with a current key, chains to it.
  3. For each event of a sealed window, the recomputed `content_hash` equals its leaf. A mismatch
     is reported as `modified` with the event id.
  4. An event in a sealed window that is not a leaf is reported as `inserted`.
  5. A leaf without its event is reported as `deleted`, unless `retention_run_seals` accounts for
     it: deleted leaves of a seal must equal the sum of its recorded retention deletions.
  6. While a satellite row exists, its recomputed digest equals the event's.

  Each run writes an `integrity_verifications` row, and a failure raises the critical alert
  `AuditHubIntegrityCheckFailed`.

- **Rotation:** `AUDIT_INTEGRITY_KEY` and `AUDIT_INTEGRITY_KEY_PREVIOUS`, following the pattern of
  `JWT_ACCESS_SECRET_PREVIOUS`: the previous key verifies, it never signs. After a rotation, the
  next checkpoint signs the head with the new key, and that re-attests every earlier seal through
  the hash chain.
- **Retention keeps a verifiable start:** seals are never deleted. When every event of a seal is
  gone, its leaves are deleted too, but the seal keeps their digest and count, so the chain from
  the first seal still verifies.
- **Gaps in `sourceSeq` are a separate concern.** They prove the origin's completeness (ADR 0005).
  The chain proves Audit Hub's storage. Both are needed: the chain can't see an event that never
  arrived, and the sequence can't see an event edited after it arrived.
- **CLI** (`pnpm --filter api audit …`, built like the template's `mail` CLI):
  - `status`: per stream, the last seal, unsealed events, lag, last verification, holds and runs;
  - `verify [--app] [--since] [--full]`: exit code 1 on failure, listing the failing events;
  - `export --app --from --to [--checkpoint]`: JSON Lines with the seals and leaves needed to
    verify the excerpt offline with `packages/audit-contract`.

## Consequences

- An event becomes tamper-evident about 2 minutes after it arrives. Before that, someone with
  owner access could still change it unseen. The panel shows "sealing pending" for those events.
- Sealing depends on the database clock. A clock that steps backwards by more than the 2-minute
  margin could put an event in a window that is already sealed; it would be reported as
  `inserted`, which is a false alarm, never a silent loss. The runbook covers clock incidents.
- A long-running transaction anywhere doesn't stall sealing, because the horizon depends only on
  insert transactions, which the trigger bounds.
- Whoever holds both owner access and `AUDIT_INTEGRITY_KEY` can rewrite history and re-sign it.
  The key lives in the secret store of the production environment, not in the database, its
  backups or the operators' machines. The exported checkpoints make even that rewrite visible
  against an external copy.
- Verifying is O(events). The daily job verifies only what is new since the last good run, and a
  full verification runs weekly, or on demand, outside peak hours.
- We would know this was wrong if seals lagged behind ingest under load (`AuditHubSealingStalled`),
  or if the window design produced false `inserted` reports. Then reconsider the watermark of
  option 2 with an explicit restore procedure.
