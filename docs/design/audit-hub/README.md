# project-template-audit (Audit Hub): design package

Status: **v2 (2026-10-14), built: phases F0 to F9 done (2026-10-18)**; F10 is optional. **Local
work only so far: no commits, no pushes, nothing uploaded.** The documents call the system "Audit
Hub" to describe its role. Its name is the folder's: `project-template-audit`. What is left is in
[What is still missing](#what-is-still-missing).

Deliverables:

- [architecture.md](architecture.md): components and the journey of an event (Mermaid).
- [contract.md](contract.md): event JSON Schema, catalog format, ingestion, webhooks, query API.
- [data-model.md](data-model.md): Prisma, the SQL Prisma doesn't express, and the template patch.
- [dependencies.md](dependencies.md): new dependencies, with license and reason.
- [f10-auditors-app.md](f10-auditors-app.md): the plan of the optional F10, the auditors' mobile
  app (proposed, not started).
- ADRs:
  - [0005](../../adr/0005-define-the-integration-contract-and-idempotency.md) contract and idempotency;
  - [0006](../../adr/0006-sign-ingestion-requests-with-hmac-sha256.md) request signing;
  - [0007](../../adr/0007-make-audit-tables-append-only-with-retention-in-the-database.md) append-only and retention;
  - [0008](../../adr/0008-seal-the-audit-log-in-time-windows.md) integrity;
  - [0009](../../adr/0009-distribute-connectors-as-vendored-source.md) connector distribution;
  - [0010](../../adr/0010-generate-the-example-projects-in-ci.md) example projects and template patches;
  - [0011](../../adr/0011-geolocate-ips-with-an-optional-local-database.md) geolocation and data license;
  - [0012](../../adr/0012-require-totp-and-recent-authentication.md) MFA and recent authentication;
  - [0013](../../adr/0013-deliver-webhooks-and-response-actions-through-an-outbox.md) webhooks and response actions;
  - [0014](../../adr/0014-build-the-admin-pages-lazily-with-own-svg-charts.md) admin pages;
  - [0015](../../adr/0015-say-who-acted-and-from-where-precisely.md) names, masked phones, client
    hints and a precise position when a session starts.

## Decisions taken

| Topic                  | Decision                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                   | `project-template-audit`: root `package.json`, images, `<title>`, OpenAPI title                                                                                     |
| Package scope          | None. Private workspace packages named like the template's `api` and `web`: `audit-contract`, `audit-nestjs`, `audit-expo`, `audit-web`. Never published (ADR 0009) |
| This folder            | It is Audit Hub, no longer the web template. F0 may reset git (`git init -b main`), but no commit is made until you ask                                             |
| Template sources       | Web from GitHub at `8d52b7b` (the commit this folder was cloned at); app from `project-template-app` at `d914c7c`, only read                                        |
| Country                | Mexico: the LFPDPPP of 2025, plus the GDPR for data subjects in the EU (see "Legal framework")                                                                      |
| Connector distribution | Vendored source with `pnpm connector add\|status\|diff\|update` (ADR 0009)                                                                                          |
| MFA                    | Mandatory for every account (ADR 0012)                                                                                                                              |
| Panel language         | English                                                                                                                                                             |
| Rate limits            | No deviation: the template's global limit stays, plus a per-app quota inside its own mechanism (ADR 0006)                                                           |

## How the design follows the templates (no conflicts left)

| Template rule                                                                        | How the design keeps it                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON fields in `camelCase`                                                           | The wire uses `camelCase` (`eventId`, `sourceSeq`…); the database `snake_case`                                                                                                                                                                        |
| Global per-IP rate limit, never replaced                                             | Kept on every route. The per-app quota counts in the template's `RATE_LIMIT_STORE` and answers its `429` + `Retry-After`. The connector paces itself (one batch every 2 s)                                                                            |
| 100 kB JSON body limit                                                               | Batches of at most 100 events and 100 kB; the connector splits by size                                                                                                                                                                                |
| No raw body                                                                          | The signature covers the RFC 8785 canonical JSON of the parsed body: no `rawBody`, no `server.ts` change, here or in the connected apps                                                                                                               |
| Route without a user: in the public list of `openapi.spec.ts`, with a reason         | `/api/ingest/`, `/api/connector/` and the apps' `/api/audit/webhooks` follow that recipe; the spec also checks the `auditSignature` scheme                                                                                                            |
| New role: the "add a role" recipe (an expand step)                                   | `viewer` and `auditor` are added; `member` stays as a role but, since 2026-10-19, cannot sign in ([security.md](../../security.md#who-may-sign-in))                                                                                                   |
| Every new failure ships with its alert and runbook (DoD)                             | Each phase adds its own alerts, runbooks and promtool tests; F9 adds the dashboards and the guides                                                                                                                                                    |
| Web budget: lazy first, raise only in a reviewed change                              | The **SPA connector fits the existing budgets** (below). Audit Hub's own panel adds measured budgets in the change that adds its screens (ADR 0014), as manual 2.8 expects                                                                            |
| App: `X-App-Version` / `X-App-Build` in `src/api/http.ts` (RELEASES.md)              | Implemented there, with `X-Device-Id`; request ids come from `expo-crypto`                                                                                                                                                                            |
| App: storage only through `src/lib/storage`; secure store for the refresh token only | Installation id in `persistentStorage` (`STORAGE_KEYS.auditInstallation`); the SQLite queue in its own file, opened by an adapter in `src/lib/storage`                                                                                                |
| App: the five offline requirements                                                   | Met: `eventId` idempotency; server support (`/api/audit/client-events` deduplicates); no conflicts (append-only); one queue per user, ordered by `occurredAt`; retry for network, timeout, 5xx and 429, drop for 4xx; at sign-out, flush then discard |
| App: `session.end()` clears the token before the listeners run                       | The app calls `audit.beforeSignOut()` before `signOut()` (3 s at most)                                                                                                                                                                                |
| App: a link never performs an action                                                 | The "Was it you?" push opens a screen; the user answers there                                                                                                                                                                                         |
| App: one global notification handler; channels in `configureNotifications()`         | The `security` channel is added there; the connector never replaces the handler                                                                                                                                                                       |
| App: preferences validated on read (a new field without a default resets them all)   | The location consent is a new field with `.default('unknown')`, separate from analytics                                                                                                                                                               |
| App: Jest doesn't transform scoped packages                                          | Vendored source; specs that run under both Vitest and Jest                                                                                                                                                                                            |
| Database roles (`roles.sql` grants every table)                                      | Audit Hub's own `roles.sql` calls `audit_apply_runtime_privileges()` after its grants; the trigger holds even if someone forgets                                                                                                                      |

### SPA connector, inside the template's budget

The web template has about 1.9 kB of initial JS left and 1.5 kB of total JS (`performance-budget.json`).
The connector is designed so that **no budget changes**:

- **Reporter: ≤ 0.6 kB gzip, a lazy chunk.** `main.tsx` imports it after the first render, like
  Web Vitals, and only when `GET /api/auth/capabilities`, the template's own switch for optional
  features (`useCapabilities`), answers `auditClientEvents: true`.
  - It queues up to 20 events in memory and flushes them through the SPA's `api` client (in the
    initial bundle already) on a timer and when the page is hidden (`visibilitychange`, with
    `keepalive`): the last moment a page is sure to get, which `pagehide` is not.
  - Its ids come from `crypto.getRandomValues` (UUIDv7).
  - It only counts in the total budget (+0.6 of 1.5 kB).
- **What it reports** (events the server can't see):
  - `client.security.csp_violation`, from the `securitypolicyviolation` listener (directive and
    blocked URI origin only);
  - `client.navigation.return_path_rejected`, when `auth/return-path.ts` refuses an
    open-redirect attempt;
  - `client.session.expired`.
- **"My account's security":**
  - a section inside the already lazy `AccountPage`, at most 0.5 kB, inside the 13 kB "Account and
    admin pages" budget (0.8 kB free);
  - it lists `GET /api/account/activity` with the template's `useLoader` + `call()` and its table
    styles, and has no hook of its own;
  - it shows "IP Geolocation by DB-IP" when it shows a city or country.
- **Measured, not assumed:** F8 runs `pnpm perf:check` on the generated example. If a figure
  doesn't fit, the activity section becomes its own lazy route, inside the same budgets, before
  any budget is touched.
- **Measured (F8):** the initial JavaScript does not change. The reporter's chunk is 1.3 kB
  (the contract's UUIDv7, the per-user queue, the CSP listener), not 0.6, and the activity 0.4 kB
  inside the account page's budget. The template's total had 1.1 kB left, not 1.5: the example
  gives the reporter a budget of its own (1.5 kB) and raises the total from 157 to 158 kB, with
  that reason in `performance-budget.json` (the template's way: a reviewed change that says why).
- **Location** comes only from the IP: the template blocks geolocation (`Permissions-Policy`).

## Template gaps, and how each one is covered

"Patch" means the F9 template patches: `git format-patch` series under
`examples/<kind>/template-patch/` (web: ten commits; app: four), each passing the template's own
gates, proven in CI on the generated examples, never pushed (ADR 0010). Building them found three
defects of the web template, patched too: an integration reset that deadlocked now and then with
the mail worker's sweep, focus assertions that raced an effect, and lazy pages that took longer
than Testing Library's default second under coverage. Running the app's Maestro flows on an
Android 16 (API 36) emulator found one of the app template: its offline banner was drawn under
the status bar (the app draws edge to edge), where the `05-offline` flow could not see it.

| Gap (found in the template's code)                                                     | Coverage                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed sign-ins are recorded nowhere                                                   | `audit.recordAlone()` (its own short transaction) in `AuthService.signIn` before the 401: `auth.session.sign_in_failed`, with `emailHmac` even for unknown addresses. Patch                                                                                                           |
| `signIn()` doesn't expose its transaction (`sessions.create` owns it)                  | Patch: optional `onCreated(tx)` hook in `SessionsService.create`, so the sign-in event commits with the session                                                                                                                                                                       |
| `revokeAll()` doesn't raise `security_version` (access tokens live 15 more minutes)    | Patch: `revokeAll()` raises it, through `endSessionsLocked(tx, userId)`, which the new flows and the connector's actions use                                                                                                                                                          |
| No role-change endpoint                                                                | Patch: `PATCH /api/users/:id` with `role` (admin, raises `security_version`, refuses to demote the last admin who may sign in, under the admins' locks), event `iam.user.role_changed`. Audit Hub has its own (F5)                                                                    |
| No account deactivation                                                                | Patch: `users.disabled_at`, refused by sign-in (same 401 as a wrong password), refresh and the guard; `PATCH /api/users/:id` with `disabled`; enables `disable_account`                                                                                                               |
| No forced password change                                                              | Patch: `users.password_change_required_at` (`POST /api/users/:id/require-password-change`); sign-in answers 403 and queues the existing `password_reset` email; enables `require_password_change`                                                                                     |
| No account deletion (right to erasure)                                                 | Patch: `POST /api/account/deletion` (current password, sessions ended, cascades as the schema already says) records `account.user.deleted` with the tag `privacy.erasure_requested`; Audit Hub runs the erasure when it ingests it. Admins delete others with `DELETE /api/users/:id` |
| No push sender, push-token registration not wired                                      | The connector's optional push module (`audit_push_tokens`, `PUT/DELETE /api/account/push-token`, `ExpoPushSender`); the app implements its existing `PushTokenRegistrar` with it                                                                                                      |
| Push can't arrive on the template's emulator (no Google Play)                          | The Maestro flow opens the notification's deep link; the push sender has a contract spec; one manual device check in the release checklist                                                                                                                                            |
| `LockService` without Redis coordinates one process only                               | Every job also takes a PostgreSQL advisory lock                                                                                                                                                                                                                                       |
| Admin reads of other users' records are not logged (docs/authorization.md asks for it) | Patch: `iam.user.viewed` in `UsersService.findVisible` (admin ≠ owner), `iam.users.listed` in `list`                                                                                                                                                                                  |
| Cross-origin refusals and auth 429s leave no trace                                     | Patch: `http.request.cross_origin_refused` from `FetchMetadataGuard` and `http.request.rate_limited` from `RateLimitGuard` (auth routes; first per IP and route per minute)                                                                                                           |
| `invitations.revoke` has no transaction                                                | Patch: wrap it, with `iam.invitation.revoked` inside                                                                                                                                                                                                                                  |
| App: request ids from `Math.random`                                                    | App patch: `expo-crypto` (a store build, noted in RELEASES.md)                                                                                                                                                                                                                        |
| App: `X-App-Version`/`X-App-Build` prescribed but missing; no device id                | App patch: `http.ts` sets them, with `X-Device-Id` from the installation id                                                                                                                                                                                                           |
| App: no offline queue                                                                  | The connector's SQLite queue (five requirements above)                                                                                                                                                                                                                                |
| App: the offline banner under the status bar, edge to edge (Android 15 and later)      | App patch: `OfflineBanner` takes the status bar's place and gives the screens below it a top inset of 0 while it shows (no gap under the headers, navigation state kept)                                                                                                              |
| App: inventory, lifecycle and store declarations for the new data                      | App patch: rows in SECURITY.md#data-inventory and MOBILE_ARCHITECTURE.md (app lifecycle), STORE_COMPLIANCE.md (Device ID; coarse location if it is turned on)                                                                                                                         |
| Integration database has no `app_runtime` role                                         | Audit Hub's test setup creates it with production's grants, so the append-only specs run as the API would                                                                                                                                                                             |
| The web template's docs say "1.0.0", its manifest says 1.2.0                           | Audit Hub starts at `0.1.0` in F0                                                                                                                                                                                                                                                     |

## Connectors at a glance

- **`audit-nestjs`** (installed into `apps/api/src/audit/`):
  - `AuditModule.forRoot(auditConfigFromEnv(env))`, where the variables come from the app's env
    schema:
    - `AUDIT_HUB_URL`, `AUDIT_HUB_KEY_ID`, `AUDIT_HUB_KEY_SECRET`;
    - `AUDIT_HUB_WEBHOOK_SECRET` (+ `_PREVIOUS`), `AUDIT_HUB_PSEUDONYM_KEY`;
    - `AUDIT_HUB_RESPONSE_ACTIONS`, `AUDIT_HUB_PUSH`.

    Without them it is off: nothing is queued, the routes answer 404, and the boot is unaffected.

  - Recording: `audit.record(tx, event)`, `audit.recordAlone(event)`, and
    `audit.diff(before, after, spec)` with masking.
  - Workers: the forwarder (sequence, batches, backoff, `Retry-After`), heartbeat and catalog.
  - Endpoints: `POST /api/audit/client-events`, `GET /api/account/activity`,
    `POST /api/audit/webhooks`, `GET` and `POST /api/account/security-prompts…`, and push tokens.
  - Handlers registered by the app.
  - Ports wired once in `audit.wiring.ts`: Prisma, `LockService`, `createExternalHttpClient`,
    metrics.
- **`audit-expo`** (installed into `src/lib/audit/`):
  - Ports:
    - `AuditTransport`, implemented in `src/api/audit.ts` with the `api` client;
    - `AuditQueueStore`, implemented in `src/lib/storage/auditQueue.ts` with `expo-sqlite`, in its
      own database file;
    - `InstallationIdStore`;
    - `LocationProvider`, optional, built only when the app passes `expo-location`.
  - Hooks with no UI: `useAccountActivity`, `useSecurityPrompt`, built on TanStack Query.
  - Context: `expo-device`, `expo-application`, `expo-updates`, `expo-network`, `Intl`.
  - Coordinates only with the separate consent: rounded to 0.01°, or to five decimals when the
    person allowed the precise position (a fresh fix when a session starts only: at sign-in, or
    when the app opens with its session kept; since 2026-10-19).
- **`audit-web`** (installed into `apps/web/src/audit/`): the lazy reporter above.

## Legal framework (Mexico, plus the GDPR)

- **Mexico:** the Ley Federal de Protección de Datos Personales en Posesión de los Particulares.
  - The new law was published in the DOF on 2025-03-20 and took effect the next day, replacing
    the 2010 law.
  - Supervision moved from the INAI to the Secretaría Anticorrupción y Buen Gobierno.
  - The Cámara de Diputados lists a later reform (DOF 2025-11-14), so read the current text at
    diputados.gob.mx.
  - Roles: each connected application's owner is the **responsable**; whoever operates Audit Hub
    acts as **encargado** on its behalf.
- **ARCO rights mapped onto the design:**
  - Access: `GET /api/connector/subjects/:subject/export`.
  - Rectification: audit events record facts and are not rectified. Profile data lives in the
    application, and Audit Hub keeps only pseudonymous ids, with labels that expire in 90 days.
  - Cancellation: erasure deletes the satellite data, and the event stays pseudonymized while a
    legal duty or a legal hold requires it.
  - Opposition to automated processing: rules only raise alerts. Every action on a person needs a
    human request, and approval by default (ADR 0013).
- **F9 adds templates to `docs/privacy/`:**
  - processor contract;
  - privacy-notice paragraphs for connected apps;
  - impact assessment;
  - the ARCO procedure.

  They follow the template's rule that docs are in English; the binding Spanish version is
  counsel's work.

- **Not verified, needs legal review:** the 2025 law's exact provisions on encargados and
  transfers to them, response deadlines, the cancellation "blocking" period, and cross-border
  hosting (the VPS region).

## What is still missing

Phases F0 to F9 are done; F10 (the auditors' mobile app) is optional, planned in
[f10-auditors-app.md](f10-auditors-app.md). Nothing blocks local work.

1. **Checked during the phases:**
   - Prisma leaves the SQL-only partial indexes and triggers alone (F1): `migrate dev` writes no
     migration for them.
   - `uqr`'s `encode()` (F5).
   - The measured size of the SPA connector (F8): 1.3 kB gzip, its own budget.
   - The Android coarse-only dialog (F9), on an emulator with the release build: the APK asks for
     `ACCESS_COARSE_LOCATION` only, and Android shows "Allow … to access this device's approximate
     location?" with no precise option and no "all the time".
   - `Intl` in Hermes (F9): on Android, `dateStyle`/`timeStyle` format as expected (en-US
     "Oct 17, 2026, 8:22 PM", es-MX "17 oct 2026, 20:22"); Hermes documents `Intl.DateTimeFormat`
     on both platforms, `dateStyle`/`timeStyle` missing only below Android SDK 24 (the app's
     minimum is 24). iOS cannot run on Linux: the app's manual device testing before each release
     (its TESTING.md and PRODUCTION_READINESS.md "Device testing", on a recent iPhone) now names
     both checks, the dates and the location prompt.
   - The app's 11 Maestro flows pass on an Android 16 (API 36, `default`) emulator, as CI runs
     them; that run found the offline banner under the status bar, now an app patch.
2. **Only you or your organization can provide these, without blocking local work:**
   - production PostgreSQL ≥ 17 (18 preferred) and its hosting region;
   - production secrets (`AUDIT_SECRETS_KEY`, `AUDIT_INTEGRITY_KEY`, …);
   - the monthly DB-IP download;
   - an Expo/EAS project for push;
   - the SECURITY.md contact and CODEOWNERS;
   - legal review of `docs/privacy/` (its "Needs legal review" points);
   - a GitHub repository and the first pull request: CI runs there, and the ADRs become
     `Accepted` when they merge (docs/adr/README.md).

## Observability (what each phase adds)

| Phase              | Metrics (low cardinality: `connected_app` = slug, never users or paths)                                                                                                                                                                                                                                    | Alerts (runbook in docs/incident-response.md, promtool test)                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2                 | `app_ingest_requests_total{connected_app,endpoint,outcome}`, `app_ingest_events_total{connected_app,outcome,reason}`, `app_ingest_batch_events`, `app_connected_app_heartbeat_age_seconds`, `app_connected_app_queue_size`, `app_connected_app_queue_oldest_age_seconds`, `app_ingest_sequence_gap_events` | `AuditHubAppSilent`, `AuditHubSequenceGap`, `AuditHubConnectorBacklog`, `AuditHubIngestRejections`, `AuditHubSignatureFailures`                                                        |
| F3                 | `app_integrity_unsealed_age_seconds`, `app_integrity_checks_total{outcome}`, `app_job_last_success_timestamp_seconds{job}`, `app_audit_hub_db_privileges_ok`                                                                                                                                               | `AuditHubSealingStalled`, `AuditHubIntegrityCheckFailed` (critical), `AuditHubIntegrityCheckMissing`, `AuditHubRetentionSweepMissing`, `AuditHubDatabasePrivilegesTooBroad` (critical) |
| F4                 | `app_webhook_deliveries_total{connected_app,target,outcome}`, `app_webhook_outbox_waiting`, `app_webhook_outbox_oldest_age_seconds`, `app_alerts_open{severity}`, `app_geoip_database_age_days`                                                                                                            | `AuditHubWebhooksFailing`, `AuditHubSecurityAlertsUnattended`, `AuditHubGeoIpDatabaseStale`                                                                                            |
| F7 (connected app) | `app_audit_outbox_waiting`, `app_audit_outbox_oldest_age_seconds`, `app_audit_events_total{outcome}`, `app_audit_hub_requests_total{kind,outcome}`                                                                                                                                                         | `ApiAuditBacklog`, `ApiAuditRejections`, `ApiAuditHubRefused` (rules, tests and runbook in the example, ready to copy)                                                                 |
| F9                 | dashboards `audit-ingest`, `audit-integrity`, `audit-apps`                                                                                                                                                                                                                                                 | —                                                                                                                                                                                      |

## Privacy at a glance

| Data                                                                                  | Where                                     | Retention (default; extensible, never below) | After erasure                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| App user id, role, email HMAC (per-app key)                                           | `audit_events`                            | the category's (730/365/180/30)              | kept: pseudonymous                             |
| Labels (a person's name), masked phone, IP, user agent, client hints, device id, city | `event_personal`                          | 90 days                                      | deleted (unless a legal hold matches)          |
| Device coordinates (consent; 0.01°, or 5 decimals when precise was allowed)           | `event_locations`                         | 30 days                                      | deleted                                        |
| Country, ASN, IP scope, UA family, OS, device model                                   | `audit_events`                            | the category's                               | kept (not identifying on their own)            |
| Values of personal fields in diffs                                                    | `event_personal.personal_change`          | 90 days                                      | deleted; the event keeps `{"$personal": true}` |
| Use of Audit Hub (searches, details, exports)                                         | `audit_events` (audit_access, own stream) | 730 days                                     | —                                              |

No emails, IPs or names in logs, metrics or Sentry, on either side. Sensitive values never leave
the application (`"[REDACTED]"`).
