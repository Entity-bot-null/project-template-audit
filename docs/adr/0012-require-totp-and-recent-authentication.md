# 0012. Require TOTP for admins and auditors, and recent authentication for sensitive actions

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

Audit Hub holds the security history of every connected application, and its admins can close
sessions or disable accounts in them. A stolen password must not be enough to get in.

The template has no MFA: docs/security.md lists it as product work. It has no "recent
authentication" either, only "requires the current password" for password and email changes. Its
model:

- access tokens are JWTs of 15 minutes, with claims `{sub, role, sv}`, held in memory;
- refresh tokens rotate in families in an httpOnly cookie;
- `security_version` ends access at once.

The brief asks for:

- mandatory MFA (TOTP with recovery codes) for `admin` and `auditor`;
- recent re-authentication before exporting, managing keys and launching response actions;
- an allowed-license library;
- an ADR.

## Options

1. **TOTP (RFC 6238) with recovery codes.** It works with every authenticator app, offline, at no
   cost. A code can be phished in real time.
2. **WebAuthn / passkeys.** Phishing-resistant, but it needs a library
   (`@simplewebauthn/server`, MIT) and browser flows that differ by platform, and recovery is
   harder for a small team. A good second factor to add later.
3. **One-time codes by email.** They depend on the mailbox, which is the same thing a password
   reset depends on, so they don't add a real second factor.
4. **SMS.** Not considered (SIM swapping, cost, a provider).

Libraries for option 1:

- `otpauth` 9.5.2 (MIT, one dependency, trusted publisher);
- `otplib` 13.5.0 (MIT, nine packages);
- our own implementation with `node:crypto`.

## Decision

Option 1 with `otpauth`. Option 2 is left for a later ADR.

- **Who:** every account (`member`, `viewer`, `auditor`, `admin`) must have a confirmed factor,
  as decided on 2026-10-14. Read access to audit data is sensitive in itself, and one rule for
  everybody leaves no role to forget.
- **Factor:**
  - The secret is 20 random bytes, encrypted with `AUDIT_SECRETS_KEY` (`mfa_factors`).
  - SHA-1, 6 digits, a 30 s period, ±1 step of tolerance.
  - `last_used_step` refuses the same code twice.
  - Enrollment shows the `otpauth://` URI and its QR, built with `uqr` as a module matrix (rows of
    `0`/`1`) and drawn by the SPA as one SVG path with its quiet zone: no `img-src blob:`, no inline
    markup, and the secret never goes to a third-party service. The key is also shown as text.
- **Recovery codes:** 10 codes of 10 characters (about 50 bits each), shown once and stored as
  `HMAC(pepper, code)`, with the pepper derived from `AUDIT_SECRETS_KEY`. Using one sends the
  security notice `mfa_changed`. Verifying one spends the challenge and the code in one
  transaction, so a request that loses the race for the challenge never costs a code. An admin can
  reset another person's factor (with step-up, a reason and an `audit_access` event), and that also
  ends the person's sessions.
- **Sign-in flow:**
  1. `POST /api/auth/sign-in` checks the password exactly as today.
  2. It starts no session for any account. It answers
     `{ mfa: 'verify' | 'enroll', challengeToken }`: 32 random bytes, only the SHA-256 kept in
     `mfa_challenges`, 5 minutes, 5 attempts, single use.
  3. `POST /api/auth/mfa/verify` (code or recovery code), or `POST /api/auth/mfa/enroll` followed
     by `POST /api/auth/mfa/enroll/confirm`, creates the session. Both are under `/api/auth`, where
     the refresh cookie travels, so they retire the session the browser had, as sign-in did.
  4. The family is marked `sessions.mfa_verified_at`.
  5. Access tokens gain `mfa: true` and `amr`.

  Accepting an invitation and confirming a sign-up go straight to enrollment: they answer an
  `enroll` challenge instead of a session. The SPA shows the recovery codes before it starts the
  session (the refresh cookie is already set), so the guards do not move the person on before
  the codes were kept.

- **Enforcement:** the access token payload requires `mfa: true`, so `JwtAuthGuard` refuses a
  token without it (401, like any invalid token). Refresh refuses a family without
  `sessions.mfa_verified_at`, and copies it to the successor; it never takes it from the request.
- **Recent authentication:**
  - `POST /api/account/step-up` takes the password and a TOTP code, and returns a new access token
    with `ra` (now, in seconds) and `amr` `['pwd', 'otp']`. The SPA simply replaces its in-memory
    token. It is under `/api/account`, not `/api/auth`: the SPA sends the access token only outside
    `/api/auth`, and the route needs the signed-in person.
  - `@RequireRecentAuth(300)` checks `reauthAt` within 5 minutes, and answers 403 with
    `Audit-Error: reauthentication_required`, which the SPA turns into the step-up dialog.
  - It applies to:
    - exports;
    - creating, rotating or revoking app keys and webhook secrets;
    - requesting or approving response actions;
    - creating or releasing legal holds;
    - changing retention policies;
    - changing roles or app assignments;
    - resetting someone's MFA.
  - The claim does not survive a refresh, so step-up lasts at most one access token (15 minutes).
- **Limits:** `@RouteRateLimit` on verify, enrollment and step-up: 10 a minute per IP, the
  sign-in route's limit. Five, as first proposed, left a person behind a shared address no room
  for a mistyped code. Guessing is held back by the challenge instead: 5 attempts, then a new
  password step, against a million codes of which three are valid at a time. Every failed code is
  recorded as a security event of Audit Hub itself (`hub.session.sign_in_failed`, stage
  `second_factor`).
- **Readiness:** the health and readiness routes do not change: they need no session.
- **Seed and tests:** the development seed gives its accounts a fixed, public TOTP secret and
  prints it. It refuses production as it already does. E2E computes codes from that secret, or from
  the key the enrollment page shows, with its own RFC 6238 code (`e2e/support/session.ts`): an
  independent check of the API's library. It never presents a step twice for the same secret.

## Consequences

- Signing in to Audit Hub takes one more screen for everyone. The SPA gains three screens
  (verify, enroll, recovery codes) in one lazy chunk, fetched while the password is checked: 2.4 kB
  gzip, with its own budget of 3 kB, and the JavaScript total grows from 157 to 160 kB
  (`apps/web/performance-budget.json`). The initial bundle stays within its 110 kB.
- The template's auth flow changes (sign-in answer, token claims, guard), so Audit Hub's contract
  differs from the template's from F5 on. Rebasing template updates touches these files; the ADR
  records why.
- Losing `AUDIT_SECRETS_KEY` disables every factor, and admins then recover through
  `pnpm --filter api user:reset-mfa`, a CLI run on the server like `user:create`.
- We would know this was wrong if phishing of TOTP codes became a real risk for Audit Hub's users
  (then add WebAuthn and make it mandatory for admins), or if step-up prompts were so frequent
  that people worked around them (then widen the window per action, never globally).
