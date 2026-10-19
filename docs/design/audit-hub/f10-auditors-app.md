# F10: the auditors' mobile app (plan)

Status: **proposed, not started (2026-10-19).** Optional. Nothing here is built; it starts only
after this plan and its ADRs are approved, like F0 to F9.

## Purpose

A phone app for the people who use Audit Hub (administrators, auditors, viewers), created from
project-template-app. It is not for the users of the connected applications: their app side is the
Expo connector (F8).

Everything it does, the admin pages already do. What it adds is mobility: an alert reaches the
person on their phone, and they can look at it and act on it without a computer.

## Scope

### Version 1

| Screen           | What it does                                                                 | Audit Hub routes it uses                                                                               |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sign-in          | Password, then the authenticator code (or a recovery code)                   | `POST /api/auth/sign-in`, `POST /api/auth/mfa/verify`                                                  |
| Overview         | Each visible application: events in 24 h, rejections, open alerts, heartbeat | `GET /api/overview`                                                                                    |
| Alerts           | The list, newest first, filtered by status and severity                      | `GET /api/alerts`                                                                                      |
| An alert         | Its summary, events and history; review it, assign it, change its status     | `GET /api/alerts/:id`, `PATCH /api/alerts/:id`                                                         |
| Response actions | The ones waiting for a second administrator; approve one after a step-up     | `GET /api/response-actions`, `GET /api/response-actions/:id`, `POST /api/response-actions/:id/approve` |
| An event, a user | The event's detail, and the user's activity (360°), read only                | `GET /api/events/:id`, `GET /api/connected-apps/:appId/subjects/:subject`                              |
| Account          | The person's own second factor status, sign-out, notifications on or off     | `GET /api/account/mfa`, `POST /api/auth/logout`                                                        |
| Step-up          | Password and a fresh code before a sensitive action                          | `POST /api/account/step-up`                                                                            |

Check each route against `openapi/openapi.json` when the work starts: the plan names the routes as
they are today.

### Not in version 1

- Searches and exports of the explorer, retention, legal holds, integrity, applications and their
  keys, users and invitations, erasure, the end of an application's service. They stay in the
  admin pages: they are rare, long or destructive, and a phone screen adds risk to them.
- Setting up the second factor on the phone. The first sign-in and its enrollment happen in the
  admin pages; the phone only verifies codes.
- Tablets and landscape layouts beyond what the template already supports.

## What Audit Hub must add first

### 1. A session for a mobile client (needs an ADR)

The admin pages keep the refresh token in an HttpOnly cookie (`session-cookies.ts`). The app
template expects the refresh token in the response body, kept in the phone's secure storage
(`src/api/client.ts`, `POST /api/auth/refresh` with `refreshToken`). Options:

1. **A mobile mode of the same session:** a marker the app sends (for example a header and no
   `Origin`) gets the refresh token in the body; rotation, reuse detection, family limits and
   `security_version` stay as they are. Browsers never get it.
2. **Cookies on the phone:** the app keeps the cookie jar. Fragile with React Native's networking,
   and against the template's design.

Recommended: option 1, with its own rate limits and a shorter family lifetime for phones. The ADR
settles the marker, the lifetimes and what a stolen phone means (the person's account is disabled
or their sessions ended from the admin pages, which already work).

### 2. Push for Audit Hub's own people (needs an ADR)

Today alerts reach people by email, Slack or Teams. The connector's push (F8) is for the connected
applications' users, not for Audit Hub's.

- A table of push tokens of Audit Hub's accounts (per installation), registered after sign-in,
  deleted at sign-out, when the account is disabled or removed, and when Expo reports a token
  dead.
- A sender through Expo's push service, reusing the connector's approach (`ExpoPushSender`).
- What a notification says: the alert's severity, rule and application, and an id that opens it.
  Never a user id, an email, an IP or a place.
- Who gets one: the same people who get the alert's email (administrators, and auditors of the
  application), only for high and critical alerts, each person able to turn it off on the phone.
- Recorded in Audit Hub's own log, like the other notifications.

### 3. Nothing else on the server

Access by application and role, step-up, and the record of every read (`audit_access`) already
apply to any client of the API.

## The app

- **Where it lives (a decision):** a repository of its own, created from project-template-app
  (recommended: the template stays universal, the app has its own releases and store listings),
  or `apps/mobile` in this repository.
- **Its contract:** Audit Hub's `openapi/openapi.json`, generated into the app with its own
  `pnpm contract`, replacing the template's example contract.
- **Sign-in:** the password step, then the code step with its challenge token, and the recovery
  code path. The template's single-step sign-in screen changes accordingly.
- **Data on the phone:** audit data is never stored on the device; screens read it from the API
  and keep it in memory only. No offline mode beyond saying the phone is offline.
- **Protection:**
  - screen capture and the app switcher's preview blocked on audit screens (FLAG_SECURE on
    Android, a privacy screen on iOS);
  - the app locks after a few minutes in the background, unlocked with biometrics or the
    device's code, before the session itself expires;
  - no audit data in logs, analytics or error reports (the template's rules already say so).
- **Links and notifications:** a notification opens the alert's screen only; it never acts
  (the template's link rules).
- **Language:** English like the admin pages, unless decided otherwise.

## Steps

| Step  | What                                                                                                     | Done when                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F10.0 | This plan approved; the two ADRs (mobile session, push for Audit Hub's people) written and approved      | the open decisions below answered                                                                    |
| F10.1 | Audit Hub: the mobile session mode, its specs, OpenAPI, security.md                                      | Audit Hub's gates green; integration specs for rotation, reuse and refusal to browsers               |
| F10.2 | Audit Hub: push tokens and the sender for its people, with the alert notification                        | gates green; a contract spec of the sender; tokens removed on sign-out, disable and removal          |
| F10.3 | The app's project from project-template-app: identity, contract, sign-in with the second factor          | the app's `pnpm verify` green; sign-in works against a local Audit Hub                               |
| F10.4 | The screens of version 1, the step-up, notifications, the lock and the capture protection                | Jest and integration specs; accessibility checks; budgets within                                     |
| F10.5 | Maestro flows: sign-in with a code, an alert reviewed, an action approved after a step-up, a push opened | the flows green on an Android 16 emulator, as in F9; a manual pass on an Android phone and an iPhone |
| F10.6 | Docs (the app's manuals in English and Spanish, Audit Hub's manual 11.x), store declarations, privacy    | the data inventory and the store forms filled in; docs/privacy/ mentions the app                     |

Each step ends like F0 to F9: every gate green, a summary, a proposed Conventional Commit message.

## Open decisions

1. Where the app lives: its own repository (recommended) or `apps/mobile`.
2. The mobile session's lifetimes, and the lock delay.
3. Whether version 1 includes approving response actions, or only reading and reviewing alerts.
4. Push for Audit Hub's people: which severities, and whether chat and email stay on as well.
5. The app's name, icons and store accounts (Apple Developer, Google Play): only the organization
   can provide them.
6. An Expo/EAS project for builds and push (the same one as F8's, or its own).

## Risks

- **A phone with audit data is lost or stolen.** Mitigated by the lock, no data at rest, capture
  protection, and ending the person's sessions from the admin pages (disabling the account ends
  them at once).
- **Notifications leak information on a locked screen.** They carry no personal data, only the
  severity, rule and application; the person can turn them off.
- **A second client of the API weakens the session model.** The mobile mode never reaches
  browsers, keeps rotation and reuse detection, and has its own limits; the ADR records why.
