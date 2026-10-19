# 0015. Say who acted and from where precisely: names, masked phones, client hints and a precise position when a session starts

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** Audit Hub maintainers

## Context

The people who read Audit Hub's log asked for more than it gave: the full name of whoever acted,
not `a***@e***.com`; the exact browser and system (an Edge on Linux read as "Chrome"; Windows 11
read as "Windows 10"); and the exact place of a sign-in, not a city.

Until now the design minimized at the origin (the design package, privacy at a glance): a masked
email as the actor's label, the user agent's family only, device coordinates rounded to 0.01° and
approximate permissions only (Android's coarse location, iOS's reduced accuracy).

Three facts limit what is possible:

- An IP address never gives an exact place: its databases give a city, with a radius of
  kilometres ([ADR 0011](0011-geolocate-ips-with-an-optional-local-database.md)).
- Browsers freeze their user agents: Windows 11 says "Windows NT 10.0", every macOS since 2020
  says 10.15.7, and Brave and Edge say "Chrome". Chromium browsers say the truth in their client
  hints (`Sec-CH-UA*` headers); Firefox and Safari send none.
- An exact place can only come from the device, and only if the person allows the precise
  position in the system's own dialog (Android 12+, iOS 14+ offer precise or approximate).

Mexico's LFPDPPP (2025) and the GDPR ask for proportionality: data adequate to the purpose, a
consent for what is not needed for the service, and a short retention for what is risky.

## Options

1. **Keep minimizing as before.** Refused: the log then fails its readers at the question it
   exists for, who did what, from where.
2. **Everything, always:** emails and phones in clear, a precise position with every event.
   Refused: an email or a phone in clear adds nothing an investigation needs that the name and the
   pseudonym do not, and a leak would hand out contact data; a position with every event is
   tracking, disproportionate for sign-in alerts, and the stores review it closely.
3. **Precise where it serves the purpose, minimized where it does not.** Chosen.

## Decision

- **Names:** an application may give a person's `name`; it is the actor's label (the explorer's
  "Actor" and the detail's "Name"). Without one, the label stays the email masked at the origin.
  Personal satellite data (`event_personal`), 90 days, erased with the person.
- **Emails:** still never stored, only their keyed pseudonym (searches by email keep working).
- **Phones:** optional (many accounts have only an email). An application may give the
  account's `phone`; only its last four digits leave it (`•••• 1234`, `maskPhone`), and Audit Hub
  drops at ingest any phone that is not masked. Stored with the label.
- **Client hints:** the connectors and Audit Hub's own pages forward the request's client hints
  (`network.clientHints`: brands, platform and its version, model, mobile); pages ask for the full
  ones with `Accept-CH` (`ACCEPT_CLIENT_HINTS`). Kept with the user agent. The detail describes
  the browser and the system from them first, and from the user agent, said as it is frozen
  ("Windows 10 or 11"), otherwise. The stored families (`ua_browser`, `ua_os`) stay the user
  agent's: the "new device" rule compares them, and a change of their names would raise an
  alert for every person.
- **A precise position when a session starts only, with consent:** the app's own consent (off by
  default) and the person's choice in the system's dialog. A session starts at sign-in, and when
  the app opens with its session kept; never on a return to the foreground. Precise: one fresh
  fix then (at most 10 seconds), kept to five decimals with the accuracy measured. Approximate: the last known
  position rounded to 0.01°, as before. Never in the background, never with other events.
  `event_locations`, 30 days. Precision follows accuracy, in the contract and again in Audit Hub
  (`locationDecimals`): a position measured worse than 1 km is approximate whatever was sent.
- **Integrity:** `event_locations` gains `coordinate_decimals` (2 or 5) and wider columns, and
  the verifier reads each row's digest at its decimals; `event_personal`'s new columns are in its
  digest only when present. Rows written before keep verifying (migration
  `20261019183000_record_phones_hints_and_precise_locations`).
- **Contract:** every change is additive (new optional fields, a looser minimum accuracy): the
  version stays 1. Connectors: `audit-nestjs` 0.3.0, `audit-expo` 0.2.0.

## Consequences

- The privacy notice, the impact assessment, the ARCO procedure and the processor contract
  (docs/privacy, both languages) declare the name, the masked phone, the client hints and the
  precise position, and the stores' forms must declare precise location for an app that asks for
  it.
- The tracking risk grows with precise positions; it is bounded by the double consent, sign-in
  only, 30 days, erasure, and every read recorded in Audit Hub's own log.
- Names identify by themselves: a leak of `event_personal` names people. It was already personal
  data; its retention and erasure do not change.
- We would know this was wrong if positions were wanted with other events, or names searched for
  outside investigations: both would need a new decision, not a quiet extension.
