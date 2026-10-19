# Connecting a project to Audit Hub

Versión en español: [connection-guide.es.md](connection-guide.es.md). Both versions describe the
same steps and commands; a change to one goes to the other in the same pull request.

How to install the NestJS connector (`packages/audit-nestjs`) in a project created from
project-template-web, record its flows, and run it; and the Expo connector (`packages/audit-expo`)
in its mobile app, created from project-template-app ([The mobile app](#the-mobile-app)), and
the SPA connector (`packages/audit-web`) in its web app ([The web app](#the-web-app)). Each
connector is copied into the project as source (ADR 0009): after `add` it is the project's code,
covered by its own lint, types, tests and coverage. `.examples/web` and `.examples/app` (ADR 0010,
`pnpm examples generate --kind web|app`) are complete projects connected this way; their changes on
top of the templates are `examples/<kind>/overlay.patch`.

## Contents

- [What the connector does](#what-the-connector-does)
- [Which applications to register](#which-applications-to-register)
- [Install](#install)
- [Wire it](#wire-it)
- [Variables](#variables)
- [Recording events](#recording-events)
- [Integration points](#integration-points)
- [Your own actions](#your-own-actions)
- [Webhooks, "Was it you?" and the account's activity](#webhooks-was-it-you-and-the-accounts-activity)
- [A user's data: erasure and blocking](#a-users-data-erasure-and-blocking)
- [Response actions](#response-actions)
- [Push notifications](#push-notifications)
- [Observability](#observability)
- [Tests](#tests)
- [Updating](#updating)
- [Turning it off](#turning-it-off)
- [The mobile app](#the-mobile-app)
- [The web app](#the-web-app)

## What the connector does

- **Records** each audit event in the project's own database, in the transaction of the change it
  describes (a transactional outbox, table `audit_outbox`): a change that rolls back records
  nothing, one that commits always has its event.
- **Forwards** the queue to Audit Hub every 2 seconds, one instance at a time, in signed batches,
  numbered without gaps (`sourceSeq`, so Audit Hub can tell when one is missing). An event leaves
  the queue only once Audit Hub has answered for it; an outage or a refusal leaves it there, and
  the forwarder retries with backoff (doubling to a minute while Audit Hub is out of reach,
  `Retry-After` on 429 and 503, 5 minutes after refused credentials). Waiting out an outage counts
  no attempt, so the whole queue drains as soon as Audit Hub is back; a batch Audit Hub fails on
  (a 500) backs off on its own, up to an hour, and never holds up the rest.
- **Checks every event** against the contract and the catalog, even while it is off: a wrong
  call fails the project's tests, not production.
- **Turns emails into pseudonyms** (HMAC with the application's own key) before they leave the
  project, and takes the client's address only through `clientIp(req)`, so `TRUST_PROXY`
  decides, never a header read directly.
- **Adds routes:** `POST /api/audit/client-events` (the apps' own events, through the API),
  `POST /api/audit/webhooks` (Audit Hub's signed webhooks), `GET /api/account/activity`,
  `GET /api/account/security-prompts`, `POST /api/account/security-prompts/:id/answer`, and
  `PUT` and `DELETE /api/account/push-token` with the push module (the account's security, for
  the signed-in person).
- **Reports** its heartbeat when it starts and every minute after (version, catalog, queue, the
  events phones discarded at sign-out), and four metrics.

Unset variables mean off: nothing is queued, no worker starts, its routes answer 404, and the
project passes every gate as before.

## Which applications to register

One application in Audit Hub per backend and per environment: the connector lives in the API,
and an application is what has its key.

| You have                                                     | Applications in Audit Hub                                |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| One API with a web app and a mobile app on top               | **One.** Each event says which client it came from       |
| The same project in production and in staging                | **One each**, with their own keys: test data never mixes |
| Two backends, each with its database (a shop, a back office) | **One each**, with correlation enabled on both           |

- **The web and mobile apps never talk to Audit Hub.** They talk to their API, as they always do.
  What a device itself has to say (a session expired, a blocked script, where the phone is, with
  consent) goes to `POST /api/audit/client-events` on that API, which forwards it. Every event
  names its client (`web`, `ios`, `android`, the app's version, the installation): the explorer
  filters by it.
- **One history per person.** A person who signs in on the web and in the app is one account of
  one application, so "new device" and "impossible travel" compare all their devices: a sign-in
  on the web in Mexico City and in the app in Madrid five minutes later is caught. Split into two
  applications, each would see half of it.
- **Audit Hub never connects to a project's database.** It would need credentials to every one
  of them; it would not know who acted, from where, or that a sign-in failed; and records the
  application can still change prove nothing. What the connector sent is sealed in Audit Hub,
  with emails already pseudonymized and sensitive values redacted at the origin.
- **Correlation** (the application's settings in Audit Hub) links what one address or one person
  does across applications: an attack on the shop and the back office from one address is one
  alert. Enable it on the applications that share people.

## Install

**A project created from the template with its patches has the connector already**, installed
and off: `examples/web/template-patch/` (the web template) and `examples/app/template-patch/` (the
app template) are `git format-patch` series their owner applies to the template
(`git am examples/<kind>/template-patch/*.patch`), and every generated example proves them
(ADR 0010). Such a project skips this section and the next: it sets the
[variables](#variables), and later keeps the connector current with [`update`](#updating).

Otherwise, from a checkout of Audit Hub at a release tag, with the project's dependencies
installed:

```sh
pnpm connector add --target ../my-project
```

`add`:

- copies the connector to `apps/api/src/audit/` and the contract it is built on to
  `apps/api/src/audit/contract/`, with their specs;
- creates the project's own adapters once, never overwritten afterwards:
  - `host.ts`: what the connector uses of the project (guards, decorators, `clientIp`);
  - `audit.wiring.ts`: the store (Prisma), the transport (`createExternalHttpClient`), the lock
    (`LockService`), and what the project does when Audit Hub asks;
  - `app-catalog.ts`: the project's own actions;
  - `audit.int.spec.ts`: the integration spec of all of it, against the project's database and an
    Audit Hub of its own on a local port;
- adds the connector's models to `apps/api/prisma/schema.prisma` between
  `// audit-connector:begin` and `// audit-connector:end`, and one line in `model User` marked
  `// audit-connector` (the relation Prisma requires on both sides);
- writes the migration (`prisma migrate diff`, no database needed). Without the project's
  dependencies installed, run `pnpm connector migration --target ../my-project` after
  `pnpm install`;
- records the version and each file's SHA-256 in `audit-connector.json`, and a pristine copy of
  each file in `.audit-connector/`, for `update`. Commit both.

It prints the remaining steps. Then, in the project: `pnpm db:migrate`.

## Wire it

Four edits, the same in every project from the template:

1. `src/env/env.schema.ts`: spread the connector's variables into the schema and check them
   together:

   ```ts
   import { AUDIT_ENV_SHAPE, checkAuditEnv } from '../audit/audit-env.js';

   export const EnvSchema = z
     .object({ ...theProjectsVariables, ...AUDIT_ENV_SHAPE })
     .superRefine((values, ctx) => {
       checkAuditEnv(values, ctx);
       // ...the project's own checks
     });
   ```

2. `src/app.module.ts`: `AuditModule.forRoot(auditConfigFromEnv(env))` in `imports`, after
   `MailModule`. The module is global: every service can inject `AuditService`.
3. `src/openapi/openapi.spec.ts`: `/api/audit/webhooks` in the public routes (Audit Hub signs
   it; it has no user).
4. `apps/api/.env.example`: the variables below, commented out.

## Variables

All five connection variables or none; Audit Hub shows them once, when the application is
registered.

| Variable                            | What it is                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `AUDIT_HUB_URL`                     | Audit Hub's origin (`https://audit.example.com`, no path); https in production                       |
| `AUDIT_HUB_APP`                     | the application's slug in Audit Hub                                                                  |
| `AUDIT_HUB_KEY_ID`                  | the signing key's id (a UUID)                                                                        |
| `AUDIT_HUB_KEY_SECRET`              | the signing key's secret (base64url)                                                                 |
| `AUDIT_HUB_PSEUDONYM_KEY`           | the key that turns emails into pseudonyms; the same for the application's whole life                 |
| `AUDIT_HUB_WEBHOOK_SECRET`          | verifies Audit Hub's webhooks; without it, `/api/audit/webhooks` answers 404                         |
| `AUDIT_HUB_WEBHOOK_SECRET_PREVIOUS` | the previous one, during a rotation                                                                  |
| `AUDIT_HUB_RESPONSE_ACTIONS`        | the response actions the project runs, comma-separated (`revoke_sessions`); needs the webhook secret |
| `AUDIT_HUB_QUEUE_ALERT`             | queued events above which the log says the queue backed up (default 10000)                           |
| `AUDIT_HUB_PUSH`                    | `expo`: push "Was it you?" to the user's phones (see below); needs the webhook secret                |
| `AUDIT_HUB_EXPO_ACCESS_TOKEN`       | Expo's push access token, when the Expo project requires one; needs `AUDIT_HUB_PUSH`                 |

The connector reports `APP_RELEASE` as its application's version in the heartbeat. Changing
`AUDIT_HUB_PSEUDONYM_KEY` breaks the link between an address's old and new events: never rotate
it unless Audit Hub's operators ask.

## Recording events

Inject `AuditService` and record where the change happens:

- **`record(tx, input)`**: in the transaction of the change, after the write. It commits with the
  change or not at all. Use it for everything that succeeds.
- **`recordAlone(input)`**: in a transaction of its own, for what happens outside one: a refused
  sign-in, a wrong password. Call it before throwing the error. It never throws for the database
  (the caller's 401 or 403 must not become a 500; the failure is logged), only for an invalid
  event.
- **`recordSampled(input, req)`**: `recordAlone` for what anyone can cause at will, as often as
  they like (a refused cross-origin request, a rate limit): only the first per action, address
  and route each minute, and at most 100 a minute per instance.
- **`change(action, before, after)`**: the `change` of an event: the action's declared fields of
  the record as read in the transaction before the write, and after it. Sensitive fields arrive
  as `[REDACTED]`, yet still count as changed.
- **`emailPseudonym(email)`**: an address as Audit Hub knows it, for a `change` about emails.

The request (address, user agent, route, method, request id, trace id, the signed-in user) comes
from the request's scope: an interceptor sets it for every handler. A guard runs before
interceptors: pass it `req`.

```ts
await this.prisma.$transaction(async (tx) => {
  const before = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true } });
  const after = await tx.user.update({ where: { id }, data: { role }, select: { role: true } });
  await this.audit.record(tx, {
    action: 'iam.user.role_changed',
    resource: { type: 'user', id },
    change: this.audit.change('iam.user.role_changed', before, after),
  });
});
```

An input has `action` (from the catalog), and optionally `outcome` (default `success`),
`severity` (default: the catalog's), `reason` (a code: `invalid_credentials`), `actor` (default:
the request's user, else anonymous), `resource`, `change`, `details` (only the catalog's fields)
and `status`. An actor with an `email` gets its pseudonym, never the address. Give a person's
`name` (`actor: { type: 'user', id, role, email, name }`) and it is their label in Audit Hub, the
name its explorer shows; without one, the label is the email masked (`a***@e***.com`). An account
with a phone linked (optional: many have only an email) can give its `phone`: only its last four
digits leave the application (`•••• 1234`, `maskPhone`). Each request's client hints go with its
events on their own (the browser's real brand, the system's version, a phone's model: Chromium
browsers send them; the full ones once the project's web server asks for them with `Accept-CH:
Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model`, the contract's
`ACCEPT_CLIENT_HINTS`). Never put a secret, a token or a password in an event; nothing outside the
declared fields is accepted.

## Integration points

Where `.examples/web` records the template's flows (base catalog, `catalog/base-catalog.ts`).
`AuditService` is each service's last constructor parameter.

| File                                    | Event                                                                                | How                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `auth/auth.service.ts`                  | `auth.session.sign_in_failed`                                                        | `recordAlone` before the 401, for an unknown address too (actor anonymous with its email)                     |
|                                         | `auth.session.signed_in` (method `password`)                                         | in the session's transaction: `sessions.create(userId, hash, onCreated)`                                      |
| `auth/sessions.service.ts`              | `auth.session.reuse_detected`, `auth.session.signed_out`, `auth.session.revoked_all` | in the rotation's, the retirement's and `revokeAll`'s transactions                                            |
| `auth/password-reset.service.ts`        | `auth.password_reset.requested`, `auth.password_reset.completed`                     | in their transactions; requested for an unknown address too                                                   |
| `auth/sign-up.service.ts`               | `auth.sign_up.requested`, `.confirmed`, `.confirm_failed`; signed in (`sign_up`)     | requested rolls back with a held-back message                                                                 |
| `invitations/invitations.service.ts`    | `iam.invitation.created`, `.revoked`, `.accepted`; signed in (`invitation`)          | `revoke` runs in a transaction for it                                                                         |
| `users/users.service.ts`                | `iam.users.listed`, `iam.user.viewed`                                                | `recordAlone`; viewed only for another person's record                                                        |
| `users/create-user.cli.ts`              | `iam.user.created`                                                                   | the account and its event in one transaction; actor `system`                                                  |
| `account/account.service.ts`            | `auth.password.change_failed`, `auth.password.changed`                               | failed before the 403                                                                                         |
| `account/email-change.service.ts`       | `account.email.change_requested`, `.changed`, `.reverted`, `.change_failed`          | the change as pseudonyms: `{ emailHmac: audit.emailPseudonym(address) }`                                      |
| `common/guards/fetch-metadata.guard.ts` | `http.request.cross_origin_refused`                                                  | `recordSampled(input, req)`; `canActivate` becomes async                                                      |
| `common/guards/rate-limit.guard.ts`     | `http.request.rate_limited`                                                          | `recordSampled` in `throwThrottlingException`; injected with `forwardRef` (an import cycle through `host.ts`) |

The template's patches add the flows the rest of the base catalog names, and record them:

| File                         | Event                                                            | How                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `users/users.service.ts`     | `iam.user.role_changed`, `iam.user.disabled`, `iam.user.enabled` | in `update`'s transaction (`PATCH /api/users/:id`); the role as a change (`audit.change`)                                          |
|                              | `auth.password.change_required`                                  | in `requirePasswordChange`'s (`POST /api/users/:id/require-password-change`)                                                       |
|                              | `account.user.deleted`                                           | in `remove`'s (`DELETE /api/users/:id`), after the row: Audit Hub erases the subject when it ingests it                            |
| `account/account.service.ts` | `account.user.deleted`                                           | in `deleteAccount`'s (`POST /api/account/deletion`), the person's own                                                              |
| `auth/auth.service.ts`       | `auth.session.sign_in_failed`, outcome `denied`                  | the right password for a disabled account (`account_disabled`) or one that must choose a new password (`password_change_required`) |

A project without those flows records these events where it adds them.

## Your own actions

`app-catalog.ts` holds the project's actions, next to the base catalog:

```ts
export const APP_ACTIONS = {
  'billing.invoice.paid': {
    category: 'audit',
    severity: 'info',
    description: 'An invoice was paid.',
    source: 'server',
    resourceType: 'invoice',
    details: { fields: { amountCents: { type: 'integer', min: 0 } } },
  },
} satisfies Record<string, ActionSpec>;
```

- **Name:** `domain.entity.verb`, lowercase; the base catalog's names are taken.
- **`category`:** `security`, `audit`, `access` or `system`; it sets the minimum retention
  (730, 365, 180, 30 days). An action never moves to a category kept for less time.
- **`source`:** `server`; `client` or `both` for the apps' events (they arrive through
  `/api/audit/client-events`).
- **`tags`:** what Audit Hub's detection rules understand (`auth.sign_in_failed`,
  `data.bulk_export`...: `TAGS` in the contract).
- **`userVisible`:** shown in "My account's security".
- **Fields** (`details`, `change`): a type (`string`, `integer`, `number`, `boolean`, `enum`,
  `uuid`, `datetime`, `id`, `ip`, `country`, `string[]`) and its limits; `required`; `personal`
  (kept apart, with a shorter retention, erased on request); `sensitive` (always `[REDACTED]`).

The catalog's version is a hash of the catalog itself, not the project's release: it changes when
an action does. The forwarder publishes it before the first events, and again if Audit Hub does
not know it.

## Webhooks, "Was it you?" and the account's activity

With `AUDIT_HUB_WEBHOOK_SECRET`, Audit Hub sends signed webhooks to `/api/audit/webhooks`
(verified over the body and the path, within five minutes; each delivery handled once):

- `security.sign_in_suspicious`: stores a "Was it you?" prompt for the user (7 days).
  `GET /api/account/security-prompts` lists the open ones; answering `not_me` runs
  `handlers.onNotMe` (in `audit.wiring.ts`: every session ended, `securityVersion` raised) and
  records `account.security_prompt.answered`.
- `alert.created`: `handlers.onAlert`, when the project defines one.
- `response_action.requested`: see below.

`GET /api/account/activity` asks Audit Hub for the signed-in person's own user-visible events,
without addresses; it answers 503 while Audit Hub cannot be reached.

## A user's data: erasure and blocking

Audit Hub keeps the project's events as its processor: when a user exercises their rights, the
project tells it ([docs/privacy/](../privacy/README.md) has the whole procedure).

- **An account deleted:** record `account.user.deleted` with the user as the resource (the
  template's patches do, in `UsersService.remove` and `AccountService.deleteAccount`). When Audit
  Hub ingests it, it erases the user's personal data (`personal` below), whatever else happens.
- **An erasure asked for** (a cancellation request, the end of a blocking period): inject
  `AuditErasureService` and call `erase(userId, scope)`:
  - `'personal'` (the default) deletes the personal data of the user's events (addresses,
    devices, labels, places); the events stay, pseudonymous, until their retention;
  - `'events'`, once the project cancelled the person's data, deletes their events too: the
    sealed ones at once (`eventsDeleted`), the rest within a day once sealed (`eventsPending`).

  It answers what was erased (`personalDeleted`, `locationDeleted`, `held`: what a legal hold
  keeps), `null` while the connector is off, and 503 while Audit Hub cannot be reached or refuses:
  ask again. The request is signed with the application's key:
  `POST /api/connector/subjects/:subject/erasure` with `{ "scope": "personal" | "events" }` (no
  body: `personal`).

- **Blocking:** after an erasure, Audit Hub keeps what is left of the events that occurred up to
  it but never answers anything of them for that person: `GET /api/account/activity` (and the
  right of access's export) leave them out (for a deleted account, an empty page), and its own
  explorer leaves them out of the per-person views. What the user does afterwards, when the
  account stays, is new data and shows as usual; an event of before that reaches Audit Hub later
  (it waited in the queue) loses its personal data there. An active legal hold that names the user
  lifts the block while it lasts.
- **The end of the application's service:** an administrator of Audit Hub suspends the
  application, then deletes its whole log ([manual](../manual.md#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application));
  from then on the application is retired and its keys are gone: unset the `AUDIT_HUB_*`
  variables ([Turning it off](#turning-it-off)).

## Response actions

Audit Hub may ask the project to act on one of its users (ADR 0013). The project runs an action
only when it is listed in `AUDIT_HUB_RESPONSE_ACTIONS` **and** has a handler in
`audit.wiring.ts`; anything else is answered `unsupported`. Each handler runs in the webhook's
transaction, with its outcome recorded there (`audit.response_action.executed`):

```ts
const handlers: AuditHandlers = {
  responseActions: {
    revoke_sessions: endSessions, // (tx, userId) => 'succeeded' | 'failed' | 'refused'
    require_password_change: requirePasswordChange,
    disable_account: disableAccount,
  },
  onNotMe: async (tx, userId) => {
    await endSessions(tx, userId);
  },
};
```

- **A project with the template's patches** has all three, as above: each does what an admin
  does there, under the same rules (`endSessionsLocked`; `users.password_change_required_at`;
  `users.disabled_at`, refused for the last admin who may sign in, under the admins' locks).
- **The adapter `pnpm connector add` creates** has `revoke_sessions` only, which any project
  from the template can run: add the other two when the project has their flows (a disabled
  account that sign-in, refresh and the guard refuse; a new password required at the next
  sign-in).

## Push notifications

With `AUDIT_HUB_PUSH=expo`, a "Was it you?" prompt reaches the user's phones as a push
notification, through Expo's push service (ADR 0013). Without it, the prompt still appears in
the app the next time it is opened.

- **The app registers each phone.** After a sign-in, the mobile app sends its Expo push token
  to `PUT /api/account/push-token` (`{ token, platform }`, `ios` or `android`); at sign-out it
  removes it with `DELETE /api/account/push-token`, so the next person to sign in on that phone
  receives nothing of the previous one. A token belongs to one account at a time: registering it
  for another moves it. Both routes answer 204, and 404 while the module is off.
- **The push carries only the screen it opens.** Its data is `{ url: "/security/prompts/<id>" }`,
  on the Android channel `security`; the user answers in the app, signed in, never from the
  notification. Its text is English by default; `handlers.promptPush(prompt)` in
  `audit.wiring.ts` says it in the project's words (`{ title, body }`).
- **Forgotten tokens.** A token Expo's service answers `DeviceNotRegistered` for (the app was
  uninstalled) is deleted. A push that fails is logged and never fails the webhook: the prompt
  is stored either way. `handlers.onSecurityPrompt` runs after both.
- **Tokens are personal data of the account:** table `audit_push_tokens`, deleted with the user.

The sender is in `audit.wiring.ts` (`expoPushSender`, the project's `createExternalHttpClient`
with a timeout), so the project's egress rules apply to `exp.host`.

## Observability

The connector's metrics, over the project's OpenTelemetry:

| Prometheus series                            | What                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_audit_outbox_waiting`                   | events in the queue                                                                                                                                                           |
| `app_audit_outbox_oldest_age_seconds`        | the oldest one's age                                                                                                                                                          |
| `app_audit_events_total{outcome}`            | events Audit Hub answered for: `accepted`, `duplicate`, `rejected`, `retry`                                                                                                   |
| `app_audit_hub_requests_total{kind,outcome}` | requests to Audit Hub by kind (`events`, `catalog`, `heartbeat`, `activity`, `erasure`) and outcome (`ok`, `rate_limited`, `unavailable`, `refused`, `failed`, `unreachable`) |

In a project from the template, `.examples/web` shows each step:

1. `observability/api-metrics.json`: the four series.
2. `apps/api/src/observability/metrics-catalog.spec.ts`: record each once
   (`recordEvents`, `recordHubRequest`, `observeQueue`).
3. `observability/prometheus/rules/api-alerts.yaml`: `ApiAuditBacklog` (the oldest event older
   than 15 minutes, for 10), `ApiAuditRejections` (events Audit Hub rejected one by one, which
   never reach it) and `ApiAuditHubRefused` (credentials refused for 10 minutes), with their tests
   in `observability/prometheus/tests/api-alerts.test.yaml`.
4. `docs/incident-response.md`: the runbook "Audit Hub connector behind".

## Tests

- The connector's unit specs come with it and run in the project's suite. They use only
  `describe`, `it`, `expect` and the doubles in `audit.testing.ts` (`MemoryStore`,
  `FakeTransport`, `TEST_CONFIG`).
- A spec that builds one of the project's services passes a real `AuditService`:

  ```ts
  const store = new MemoryStore();
  const service = new UsersService(prisma, new AuditService(TEST_CONFIG, store, () => NOW));
  // ...
  expect(store.rows.map((row) => row.draft.action)).toEqual(['iam.users.listed']);
  ```

- `audit.int.spec.ts` runs with the project's integration suite: a rolled-back change sends
  nothing, an outage loses and duplicates nothing, a forged `X-Forwarded-For` changes nothing,
  webhooks and prompts work end to end, and with no variables every route answers 404.
- The project's coverage thresholds stay as they are. `audit.wiring.ts`, like the project's other
  wiring, is covered by the integration spec.

## Updating

```sh
pnpm connector status --target ../my-project   # installed and available versions, local edits
pnpm connector diff   --target ../my-project   # what update would change
pnpm connector update --target ../my-project
```

`update` replaces each file the project left alone and merges each file it edited
(`git merge-file` against the pristine copy), leaving conflict markers where both sides
changed. It never touches the adapters; `status` says when their templates changed, so the
project can compare by hand (the next `update` records the templates they now compare to).
`pnpm connector status --check` in the project's CI fails on unexplained edits.

A version that changes the connector's tables also refreshes its models in `schema.prisma` and
writes the migration of the change (`<stamp>_update_audit_connector`), with the SQL Prisma
cannot express (checks, from `prisma/sql/<version>.sql`) for each version in between. It needs
the project's dependencies installed: without them it changes nothing and says so. Apply the
migration with `pnpm db:migrate`.

## Turning it off

Unset the `AUDIT_HUB_*` variables and redeploy: nothing is queued from then on; events already
queued stay in `audit_outbox` until it is turned on again. For good (the application's service
ended in Audit Hub, [above](#a-users-data-erasure-and-blocking)), also empty that queue: its events
would never be accepted again.

## The mobile app

The app never talks to Audit Hub: it talks to its API, which has the NestJS connector. The Expo
connector (`packages/audit-expo`, installed into `src/lib/audit/`) gives the app its side:

- **The device's own events**, the ones only the phone knows, recorded with `audit.record()`: a
  session that began (`client.session.started`, after a sign-in or when the app opens with the
  session it kept, with the phone's approximate position when the user consented), a session the
  server ended (`client.session.expired`) and a link the app refused (`client.link.rejected`). The
  API's base catalog declares them; a project's own client actions go in its `app-catalog.ts` with
  `source: 'client'`.
- **Offline, per user.** Events wait in their own SQLite file and go to
  `POST /api/audit/client-events` when the network returns, the app comes back to the foreground,
  or every 30 seconds, at most 50 a request. Network failures, timeouts, 5xx and 429 are retried;
  other 4xx drop the batch. At sign-out the queue is sent for up to three seconds, then discarded:
  never sent with the next user's session, and the next batch says how many were dropped
  (`discardedAtSignOut`, in the API's heartbeat).
- **Every request says which app sent it**: `X-App-Version`, `X-App-Build`, `X-App-Platform` and
  `X-Device-Id` (a random id of the installation). The API's connector puts them in its own events,
  so a sign-in from an installation the account never used is "new device".
- **The account's security**, for the app's screens: `useAccountActivity`, `useSecurityPrompts`,
  `useSecurityPrompt` and `useAnswerSecurityPrompt` (TanStack Query, no UI of their own).
- **"Was it you?" as a push**, with the API's push module (`AUDIT_HUB_PUSH=expo`): the app sends
  its Expo push token after each sign-in and removes it at sign-out.

### Install it

From a checkout of Audit Hub at a release tag:

```sh
pnpm connector add --kind expo --target ../my-app
```

`add` copies the connector to `src/lib/audit/` with its specs, and the part of the contract it uses
to `src/lib/audit/contract/` with theirs: the app's coverage counts every file under `src/`, so it
gets no module it does not import. The specs use only `describe`, `it`, `expect` and injected
fakes: the same files run under Vitest in Audit Hub and under Jest in the app; the queue's SQL runs
on Node's own SQLite there. It creates the adapters once:

| Adapter                           | What it is                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/api/audit.ts`                | the API's routes through the app's `api` client: the session's token, the timeout, the request id                             |
| `src/lib/storage/auditQueue.ts`   | the queue's own SQLite file, `audit-queue.db`, and the installation id in `persistentStorage`                                 |
| `src/lib/audit/audit.wiring.ts`   | the client over the Expo modules, the hooks, `signOut()`, `pushTokenRegistrar`, `registerPushToken()`, `recordRejectedLink()` |
| `src/lib/audit/audit.int.spec.ts` | the integration spec of all of it, against the app's stubbed API                                                              |

### Wire it

The edits, the same in every app from the template; `.examples/app` makes each one:

1. `pnpm expo install expo-crypto`: a native module, so the next store build carries it.
2. `openapi/openapi.json`: the API's own contract, with the routes its connector adds; then
   `pnpm contract`.
3. `src/lib/storage/index.ts`: `auditInstallation: 'audit.installation'` in `STORAGE_KEYS`.
4. `src/api/http.ts` and `src/api/client.ts`: a `headers` option on `createHttp`, read before the
   cancellation check, and `setRequestHeaders()` for both clients (the sign-in is public, and it is
   where a new device shows). Request ids from `expo-crypto`'s `getRandomValues`.
5. `src/app/_layout.tsx`: `useEffect(() => audit.start(), [])`; `audit.bindUser(user.id)` in
   `session.onSignIn`; `audit.sessionEnded(useSessionStore.getState().endedBy)` in
   `session.onSignOut`.
6. `src/app/(app)/_layout.tsx`: `audit.bindUser(id)` and `registerPushToken()` once `useMe` knows
   the user (a restored session); `useNotificationNavigation(recordRejectedLink)`;
   `usePushTokenChanges(...)` to register a replaced token again.
7. Sign out through `signOut()` from the wiring: the queue and the push token go while the session
   is still valid (`session.signOut()` clears the token before its listeners).
8. `src/app/+native-intent.tsx`: `recordRejectedLink()` for a link the allowlist refuses.
9. `src/lib/links.ts`: `/security/prompts/<uuid>` in the allowlist, with its App Links prefix; the
   screen asks, the link never answers.
10. `src/lib/notifications`: the Android channel `security` in `configureNotifications()`, high
    importance: the API pushes on it.
11. `src/test/setup.ts`: `expo-crypto` and `expo-sqlite` (Node's SQLite, in memory), and the
    connector's fake transport for `@/api/audit`, so the app's own specs need no audit routes.
12. The screens: the question (`/security/prompts/[id]`) and the account's activity, each in
    `src/a11y.spec.tsx`; the data inventory of `SECURITY.md` and the store forms.

### Location (optional)

Impossible travel needs to know where the phone is. With `expo-location` (`pnpm expo install
expo-location`), only for sign-in alerts:

- a consent of its own in the preferences (`locationConsent`, default `unknown`), turned on in
  Settings, which then asks the foreground permission: the system's dialog lets the person choose
  precise or approximate (Android 12+, iOS 14+);
- `app.config.ts`: the plugin with only `locationWhenInUsePermission`,
  `android.blockedPermissions` with `ACCESS_BACKGROUND_LOCATION`, and
  `ios.infoPlist.NSLocationDefaultAccuracyReduced: false`;
- in the wiring, `location: { provider: { lastKnown, current }, consented, precise }`:
  `lastKnown` reads the position the system already knows (`getLastKnownPositionAsync`, never the
  GPS); `precise` reads the permission (`android.accuracy === 'fine'` or `ios.accuracy ===
'full'`); `current` takes one fresh fix (`getCurrentPositionAsync` with `Accuracy.High`, 10
  seconds at most), only when precise is allowed.

The connector (0.2.0 and later) sends it only with `client.session.started`. Approximate: the last
known position, rounded to 0.01° on the device. Precise: the fresh fix, to five decimals (about a
metre), with the accuracy it was measured with. Audit Hub rounds again by the same rule (a
position measured worse than 1 km is approximate) and keeps device locations 30 days. The data
inventory and the store forms say which one the app asks for (`.examples/app`: both, the
person's choice).

### The API's side

- The catalog: the base catalog declares the three client actions; the API refuses any other
  device action (`action_not_allowed`) unless the project declares it with `source: 'client'` or
  `'both'`.
- Push: `AUDIT_HUB_PUSH=expo` (and `AUDIT_HUB_EXPO_ACCESS_TOKEN` when the Expo project requires
  one), see [Push notifications](#push-notifications).
- One application in Audit Hub for the API and every client of it
  ([Which applications to register](#which-applications-to-register)).

`pnpm connector update --target ../my-app` works as for the API: the queue's tables
change only through the connector's own migrations (`PRAGMA user_version`), run when the app opens
the queue.

## The web app

The SPA never talks to Audit Hub either. The SPA connector (`packages/audit-web`) reports what only
the page sees, through the app's own API:

- `client.security.csp_violation`: the browser blocked something the Content Security Policy
  forbids (the directive, and the blocked thing's origin or CSP keyword: never a path or a query),
  once a page for each;
- `client.navigation.return_path_rejected`: `returnPath()` refused an open-redirect attempt
  (never the value);
- `client.session.expired`: the server ended the page's session; sent if the same person signs in
  again on that page.

It costs nothing until the API's connector is on: a buffer of at most 20 events in the initial
bundle (`src/audit/report.ts`, a few hundred bytes), and the reporter in a lazy chunk that
`src/main.tsx` loads after the first render only when `GET /api/auth/capabilities` says
`auditClientEvents`. The reporter keeps the events in memory, per user, and sends them every
30 seconds and when the page is hidden (`keepalive`, it may be closing): never one person's
events with another's session. The account page lists the person's own activity.

```sh
pnpm connector add --kind spa --target ../my-project/apps/web
```

It installs into the web app's own directory, with a manifest of its own (the project's root has
the API's): the reporter in `src/audit/` with its specs, the part of the contract it uses in
`src/audit/contract/`, and the adapter `src/audit/audit.wiring.ts` (the app's `api` client and
session) with its spec. Then, as `.examples/web` does:

1. `pnpm add -D zod` in the web app: the contract's types and specs. The bundle gets none of it:
   the reporter imports only types and the UUIDv7 module (`connector.test.mjs` checks it).
2. The API: `auditClientEvents: this.audit.enabled` in its capabilities (`AuthCapabilitiesSchema`
   and `AuthController`); `pnpm contract`.
3. `src/auth/capabilities.ts`: the new field, and `loadCapabilities()` exported for
   `src/main.tsx`, which imports `./audit/audit.wiring` and calls `startAudit()`.
4. `reportAudit()` in `src/auth/return-path.ts` (a refused path, once for each navigation: the
   guard reads it on every render) and `src/auth/session.ts` (a refresh the server refused, with
   the user's id, before the session is cleared).
5. `src/pages/AccountPage.tsx`: "Recent activity" from `GET /api/account/activity`, with the
   geolocation database's attribution when the answer has one.
6. `performance-budget.json`: measured in `.examples/web`, the connector adds 1.7 kB to the total
   and nothing to the initial JavaScript (the reporter's chunk 1.3 kB, the activity 0.4 kB). The
   example gives the reporter a budget of its own and raises the total by 1 kB, with the reason.
