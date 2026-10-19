# 0006. Sign machine-to-machine requests with HMAC-SHA256 over canonical JSON, a timestamp and a nonce

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

The routes under `/api/ingest/*` (events, catalog, heartbeat) and `/api/connector/*` (subject
activity, export, erasure) are called by the API of an application, never by a person. The JWT
model of the template, with tokens bound to users and refreshed through a cookie, doesn't fit
them. Each request must prove that it comes from that application and that its body arrived
unchanged. A captured request must not be replayable, and keys must rotate without an outage. The
same scheme protects the webhooks Audit Hub sends back to `POST /api/audit/webhooks` in each
application.

The template is already configured for every application created from it, and this design does
not deviate from it:

- a route without `@Auth()` must be in the public list of `openapi.spec.ts`, with its reason;
- the global `RateLimitGuard` counts per IP and per route (`RATE_LIMIT_MAX`, 100 a minute by
  default);
- JSON bodies are limited to 100 kB;
- the raw body is not kept;
- Redis is optional, so `LockService` and the idempotency store work per process without it.

## Options

1. **A static API key** sent as a bearer token. It is simple, but a leaked request or log line
   gives full access until rotation, and it proves nothing about the body.
2. **HMAC-SHA256 over the raw body** (RFC 9530 `Content-Digest`). This is the usual scheme, but it
   needs `rawBody: true` in `server.ts`, both in Audit Hub and in every connected application,
   which changes the template.
3. **HMAC-SHA256 over the canonical JSON of the parsed body** (RFC 8785), together with the
   method, path, query, timestamp, nonce and key id. The template's parser stays in place: the
   verifier re-serializes what it produced. `packages/audit-contract` already needs a canonical
   JSON function for content hashes (ADR 0008), so this adds no dependency.
4. **Ed25519 signatures**, with only public keys stored in Audit Hub. A dump of Audit Hub's
   database then can't forge events. But Audit Hub is already the root of trust for the data it
   stores, operators would handle key pairs, and the brief asks for HMAC.
5. **Mutual TLS.** It needs a PKI and per-app certificates that the VPS deployment doesn't have.

## Decision

Option 3.

- **Body digest:** `Audit-Body-Digest: sha-256=<base64url>` of `canonicalJson(parsedBody)`. Two
  things could make the parsed value differ from what was signed, and the contract rules out both:
  - numbers outside ±2^53 (every number in the schemas is bounded);
  - duplicate keys (the signer never produces them, and a tampered body still needs a valid
    signature).

  The body must also have reached the controller, so the 100 kB limit applies first, and a
  `413` stops oversized bodies before any work.

- **Keys:** each application has at most two valid keys: the current one and the one it replaced,
  until its grace period ends (7 days by default). The key id is public. The secret (32 random
  bytes) is shown once and stored with AES-256-GCM under `AUDIT_SECRETS_KEY`. A second key,
  `AUDIT_SECRETS_KEY_PREVIOUS`, is only used to decrypt during its own rotation, and a CLI
  re-encrypts every secret with the current key. Webhook secrets, pseudonymization keys and TOTP
  secrets use the same box. The `*_PREVIOUS` naming follows `JWT_ACCESS_SECRET_PREVIOUS`.
- **Verification order** (cheap first, state last):
  1. header formats;
  2. timestamp within ±300 s;
  3. key valid and app not suspended;
  4. digest of the canonical body;
  5. HMAC compared in constant time;
  6. nonce `INSERT … ON CONFLICT DO NOTHING` into `ingest_nonces`, only after a valid HMAC, so
     the table cannot be filled without a key.

  Every failure answers `401` with an `Audit-Error` header. The header says `timestamp_skew` (with
  `Date`) only when it helps the operator, and `unauthorized` otherwise.

- **Batch size inside the template's limit:** at most 100 events and 100 kB per request, and the
  connector splits batches by size. Throughput stays far above audit volumes: one batch every 2 s
  per instance is up to 3,000 events a minute.
- **OpenAPI, following the template's recipe for routes without a user:**
  - the paths `/api/ingest/` and `/api/connector/` go into the public list of `openapi.spec.ts`,
    with the reason "machine-to-machine, protected by `@AppSignature()`";
  - a security scheme `auditSignature` documents the headers;
  - the spec gains one assertion: every operation under those paths declares `auditSignature`.
- **Rate limits, inside the template's mechanism:**
  - The global per-IP limit stays as it is. It counts per route, so events, catalog and heartbeat
    each have their own budget.
  - After the signature, `AppSignatureGuard` counts a per-app quota (`rate_limit_per_minute`, 120
    by default) in the template's rate-limit store (`RATE_LIMIT_STORE`: memory or Redis, with the
    same fallback) and answers the same `429` with `Retry-After` that `RateLimitGuard` sends.
  - The connector waits out `Retry-After`; events stay in its queue.
  - A deployment that puts many applications behind one egress IP raises `RATE_LIMIT_MAX`, an
    existing variable, in its environment.
- **Webhooks:** the same canonical string, with the delivery id in the nonce's place and the app
  slug as key id. During a webhook-secret rotation, Audit Hub sends two signatures
  (`v1=<new> v1=<old>`) until the previous secret expires, and the application accepts either. Its
  connector reads `AUDIT_HUB_WEBHOOK_SECRET` and `AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS`. In the
  application, `POST /api/audit/webhooks` is a public route following the same recipe, and it
  needs no `rawBody` either.

## Consequences

- Neither Audit Hub nor any connected application changes `server.ts`, its body limit or its
  throttling. Both keep the template's defaults, its tests and its documentation as they are.
- Canonicalization costs one re-serialization of at most 100 kB per request: negligible.
- Clocks must be synchronized (NTP), and the ±300 s window tolerates ordinary drift. A connector
  that receives `timestamp_skew` logs its offset, computed from the `Date` header.
- Each request writes one nonce row, and a sweep deletes expired nonces every 10 minutes.
- Losing `AUDIT_SECRETS_KEY` makes every stored secret unusable, and every application needs new
  credentials. It goes in the secret store with the other production secrets
  (docs/environment.md), never in the database or its backups.
- An application's key can only write and read that application's data.
- We would know this was wrong if a client in another language could not reproduce RFC 8785
  (then publish test vectors with the contract), or if nonce writes showed up in ingest latency
  (then keep nonces in Redis when it is configured, with PostgreSQL as the fallback).
