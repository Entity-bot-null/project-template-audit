# 0013. Deliver webhooks and response actions through an outbox, off by default in every application

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

Audit Hub must tell an application about two things:

- an alert was created;
- a suspicious sign-in happened, so the application can ask its user "Was it you?".

Its admins must also be able to ask an application to act on one of its users:

- close every session;
- force a password change;
- disable the account.

Each request requires a reason and recent authentication, optionally a second person's approval,
and is recorded. The application reports the outcome as an event. Each application decides which
actions it accepts, and all start off.

What the template offers (checked in its code):

- **Closing sessions:** `SessionsService.revokeAll(userId)` exists but only revokes refresh
  tokens. **It does not raise `users.security_version`**, so access tokens would keep working for
  up to 15 minutes. The flows that end access (password change, reset, email change) call
  `revokeSessionsLocked(tx, …)` and increment the version in the same transaction.
- **Forcing a password change:** no such flag exists in the template.
- **Disabling an account:** no deactivation exists either. ADR 0004 of the template names it as
  future work.
- **Push:** the backend has no push sender, and the app's push-token registration is "REQUIERE
  CONFIGURACIÓN".

## Options

1. **Call the application synchronously** when an alert or action is created. It is simple, but
   an application that is down loses the call, the admin's request waits on someone else's
   uptime, and nothing retries.
2. **A webhook outbox in Audit Hub's database**, built like the template's mail outbox (ADR 0003):
   written in the transaction that calls for it, claimed with a lease (`FOR UPDATE SKIP LOCKED`),
   retried with backoff and signed when sent.
3. **Let the application poll** Audit Hub for actions. That needs no inbound route in the
   application, but adds latency, and every application would carry a polling worker.

## Decision

Option 2. The application's side goes in the NestJS connector.

- **Outbox (`webhook_deliveries`):**
  - One worker per instance, as in ADR 0003.
  - Backoff from 30 s doubling to 1 h, with jitter; 12 attempts; deliveries expire after 24 h.
  - A `401` from the application fails at once, and alerts: a secret mismatch is not transient.
  - Gauges `app_webhook_outbox_waiting` and `app_webhook_outbox_oldest_age_seconds`, counter
    `app_webhook_deliveries_total{connected_app,target,outcome}`, alert `AuditHubWebhooksFailing`.
- **Outbound safety:** an application's delivery goes through `createExternalHttpClient`, which
  already refuses redirects; a chat message goes through the same guarded fetch with its own
  timeout, metric and log line, because that client logs the request's path and Slack's and
  Teams' URLs carry their secret in it. On top of it:
  - `https://` only in production;
  - the host is resolved and refused if it lands in a private, loopback or link-local range,
    unless `AUDIT_WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` (one VPC);
  - a 5 s timeout;
  - the response body is never stored.
- **Slack and Teams:** optional, through `AUDIT_SLACK_WEBHOOK_URL` and `AUDIT_TEAMS_WEBHOOK_URL`
  (unset means off), using the same outbox with `target` set accordingly. Messages carry the app,
  the rule, the severity and a link to the alert, never an email or an IP.
- **Email:** new `MailKind` `security_alert` through the template's mail outbox, sent to the
  admins and the auditors assigned to the app, with ids only (the panel shows the rest).
- **Response actions:**
  - An action can be requested only when all three of these allow it:
    1. Audit Hub's per-app setting (`accepted_response_actions`, empty by default);
    2. the `responseActions` the app's catalog declares;
    3. the app's own variable `AUDIT_HUB_RESPONSE_ACTIONS` (empty by default), which its connector
       checks again when the webhook arrives.
  - A request needs `@RequireRecentAuth`, a reason of 10 to 500 characters and, when the app's
    `require_action_approval` is on (the default), a second admin's approval. A CHECK makes the
    approver differ from the requester.
  - Pending requests expire after 1 hour. Every step writes an `audit_access` event.
  - The application answers the webhook at once (`accepted | refused | unsupported`), acts, and
    records `audit.response_action.executed`. Audit Hub matches it by `actionId` and settles the
    action as `succeeded` or `failed`.
- **What the connector does for each action in a project created from the template:**
  - `revoke_sessions`: in one transaction, `revokeSessionsLocked(tx, userId)` +
    `security_version + 1` + the audit event, so the next request answers 401. Works out of the
    box.
  - `require_password_change` and `disable_account`: the template had neither, so its patches
    (`examples/web/template-patch/`, prepared locally, never pushed; ADR 0010) add both, as
    expand steps:
    - `users.disabled_at`, which sign-in, refresh and `JwtAuthGuard` refuse (sign-in answers the
      same 401 as a wrong password, so an account's state isn't disclosed);
    - `users.password_change_required_at`, for which sign-in answers 403 "Password change required"
      and queues the template's existing `password_reset` email, cleared by a completed reset or
      change.

    Both end every session and raise `security_version` in the same transaction, and both get
    admin endpoints (`PATCH /api/users/:id` with `disabled`, with an `iam.user.disabled`/`enabled`
    event; `POST /api/users/:id/require-password-change`) next to the role change the template also
    lacked (`PATCH /api/users/:id` with `role`, which refuses to demote the last admin who may sign
    in). The patch that ships the connector wires both handlers in the project's
    `audit.wiring.ts`, under the same rules as an admin. In a project without those patches, the
    connector's adapter wires `revoke_sessions` only, and the other two answer `unsupported`.
- **"Was it you?":**
  1. The `security.sign_in_suspicious` handler stores an `audit_security_prompts` row (idempotent
     on the webhook id) and calls a `PushSender` port.
  2. The connector ships an optional push module, because neither template has one:
     - a table `audit_push_tokens`;
     - `PUT /api/account/push-token` and `DELETE /api/account/push-token` (`@Auth()`), which the
       app's existing `PushTokenRegistrar` interface calls;
     - an `ExpoPushSender` that calls the Expo Push API through `createExternalHttpClient`.

     It is off unless `AUDIT_HUB_PUSH=expo` (with an optional `AUDIT_HUB_EXPO_ACCESS_TOKEN`).
     Tokens that Expo reports as `DeviceNotRegistered` are deleted.

  3. The push uses the Android channel `security` and carries only `data.url` (`/security/prompts/<id>`).
  4. The app opens that screen through `lib/links.ts`, never acting from the notification itself.
  5. "Not me" calls `POST /api/account/security-prompts/:id/answer`, which closes every session as
     `revoke_sessions` does and records the answer.

## Consequences

- An application that is down receives its webhooks when it comes back, within 24 h. Expired ones
  stay visible in the panel, and the action becomes `expired`.
- The application's webhook route is public (no `@Auth()`) and signature-verified, so it joins the
  public list of the application's `openapi.spec.ts`, with its reason. The connection guide says
  so.
- Delivery is at least once. The application deduplicates by `Audit-Webhook-Id`
  (`audit_webhook_receipts`, one day), and its handlers are idempotent.
- Push depends on each project's push setup. Without a `PushSender`, the prompt still appears in
  the app's "My account's security" screen the next time it is opened.
- We would know this was wrong if applications kept missing deliveries (then add a signed polling
  endpoint as a fallback), or if two-person approval blocked urgent containment (then allow
  `revoke_sessions` without approval, per app, which is the least harmful action).
