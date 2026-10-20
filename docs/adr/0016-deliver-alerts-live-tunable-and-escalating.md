# 0016. Deliver alerts live, tunable and escalating, from the database alone

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** Audit Hub maintainers

## Context

Alerts reached people by email and chat when they were raised, and the panel showed them when a
page was opened or reloaded. Watching a security operation needs more, and asks for it without
weakening what Audit Hub already guarantees:

- **Now, not on reload:** the counters, the lists and an alert's page should change as alerts do,
  and a new critical one should be heard and seen (a sound, the browser's notice) by whoever has
  the panel open, once, not once per tab.
- **No alert lost or doubled:** a reconnection must not skip changes nor replay them as news;
  several API instances must agree; the rules' grouping (one open alert per group key) must hold
  under concurrency.
- **Tunable and quiet when asked:** administrators need to turn a rule off or change its
  threshold without a release; people working an incident need to silence a known cause for a
  while, with a reason, without hiding anything; a flood must not bury the rest.
- **Nobody forgets one:** an alert nobody takes on should be sent again, by severity.
- **The sources themselves:** a connector that stopped, a queue that does not drain, events
  refused or missing, a failed integrity verification are security facts too, raised as alerts.

Constraints: no new infrastructure (no broker, no Redis requirement), no new environment
variables, the same authentication and tenancy (the connected application, with
`user_app_assignments`), the existing durable outboxes for email and chat, and a budget of a few
kilobytes for the panel.

## Options

1. **WebSockets with a broker** (Redis pub/sub, or PostgreSQL `LISTEN/NOTIFY` fan-out): pushes at
   once. Refused: a broker is infrastructure the template keeps optional; `LISTEN/NOTIFY` needs a
   dedicated session (no transaction pooling) and loses what is sent while a listener is away, so
   a replay from the database is needed anyway; WebSockets add a second protocol to authenticate,
   rate limit and proxy.
2. **The panel polls the lists** every few seconds. Refused: a query per open page per interval,
   and no single place to decide what is news.
3. **Server-Sent Events read from the database:** each instance reads the alerts changed since
   its last read (one indexed query every 2 seconds for all its listeners), and a reconnection
   replays from a cursor (`updatedAt|id`) sent back as `Last-Event-ID`. Chosen.

## Decision

- **Stream:** `GET /api/alerts/stream`, read with `fetch` so the access token travels in the
  `Authorization` header (never the URL); every change of an alert the caller may see, as the list
  answers it; `ready`, `resync` (more than 200 changes missed: reload) and `end` (renew, access,
  shutdown) events; 5 streams per person, 500 per instance, 10 minutes each, the caller's access
  checked again every minute; `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no`
  for the proxies. The `[updatedAt, id]` index orders the changes.
- **One connection per browser:** the tabs elect a leader with a Web Lock; it shares what it hears
  over a BroadcastChannel, and only it plays sounds and shows browser notices. Each change is
  delivered once per tab (by alert id and `updatedAt`). News is an alert just opened, one whose
  severity rose, or one escalated again; replays are never news.
- **Sounds and notices:** Web Audio patterns per severity (no files), played after a gesture of
  the person; the Notification API, asked for from a click; both only while a tab is open (no push
  service, no service worker). Each person's preferences (`notification_preferences`) choose the
  severities, volume, a critical alert's repeated sound, a quiet time of at most a week and
  applications they never hear about.
- **Settings:** the catalog (`alerts/rule-catalog.ts`) describes every rule; `detection_rule_settings`
  turns one off, overrides a fixed severity, or sets its parameters within the catalog's bounds,
  read from a 30-second snapshot; administrators only, after a step-up, recorded in Audit Hub's
  own log.
- **Floods and silences:** at most 20 new alerts per rule and application within an hour, the rest
  folded into one; `alert_mutes` silences a rule or an application for 5 minutes to a week with a
  reason, holding email, chat, escalation, sounds and notices, never the alert itself nor the
  application's own webhook.
- **Acknowledgement and escalation:** acknowledging (or In review) records who took an alert on
  and stops its escalation; `escalation_policies` sends unacknowledged alerts again by severity
  (critical after 15 minutes, every 30, 3 times; high after 60, every 120, twice; the others off),
  through the existing outboxes. Closing an alert takes a reason.
- **Source health and integrity:** every minute, `source_silent`, `source_backlog`,
  `ingest_rejections` and `coverage_gap`, one alert per condition, resolved by Audit Hub when it
  clears; an idle source (heartbeats, no events) is never one. A failed verification raises
  `integrity_failure` per application, never resolved by itself.
- **Data:** migration `20261020100000_add_realtime_alerting` (new columns on `alerts`, four
  tables, checks, the policies' rows; existing alerts count their escalation from then).

## Consequences

- The panel is current without reloading, and a person hears a new critical alert once, whatever
  tabs they keep open. A notice says the alert's severity, application and title only.
- Each listening instance runs one query every 2 seconds while someone listens; nothing while
  nobody does. A change reaches the panel within about 2 seconds, not instantly: acceptable for
  people, and the price of having no broker.
- Browser notices need a tab open; closed, the person relies on email and chat (and escalation).
  Push notifications would need a service worker and a push service: a later decision.
- Settings are global, not per application; escalation's recipients are the administrators and
  the application's auditors, not an on-call rota; quiet time is a single span, not a weekly
  schedule. Each is a later decision if asked for.
- A rule turned off detects nothing: the catalog and the Detection rules page say so, and the
  change is in Audit Hub's own log.
- The panel's admin pages grew from 44.6 to 60.0 kB gzip (apps/web/performance-budget.json).
- We would know this was wrong if the per-instance polling showed in the database's load, or if
  people missed alerts with the panel closed: the first would call for `LISTEN/NOTIFY` as a wake-up
  in front of the same replay, the second for push notifications.
