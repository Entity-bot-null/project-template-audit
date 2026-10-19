# 0014. Build the admin pages as lazy routes with our own SVG charts, and give them their own budget

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

The panel has eleven screens, and auditors spend their day in it:

- overview;
- connected applications;
- event explorer and event detail;
- a user's 360° activity;
- a resource's history;
- security;
- alerts and response actions;
- retention, legal holds and integrity;
- exports;
- users.

It must not repeat the old module's failures: stored XSS through log data placed in JavaScript,
and one query per chart point with no pagination.

The template's web app constrains it:

- React 19, React Router 8, `useLoader` + `call()`, its own CSS and its accessibility conventions.
- A CSP without `unsafe-inline`: `img-src 'self' data:`, no `blob:`, and `style-src` falls back to
  `'self'`.
- ESLint bans `dangerouslySetInnerHTML`.
- `WEB_VITALS_ROUTES` must list every route.
- The performance budget (gzip):
  - initial JS 110 kB (108.1 used);
  - total JS 157 kB (about 1.5 kB free);
  - a budget whose pattern matches no file fails.

## Options

1. **A chart library** (Recharts, Chart.js, ECharts). Ready-made charts, but 40 to 150 kB gzip,
   some inline styles that the CSP refuses, and more surface.
2. **Our own SVG components.** The charts we need are few: line or area with a time axis, bars,
   a day × hour heatmap, a sparkline and a meter. They are React elements with SVG attributes and
   CSS classes, so the CSP doesn't change, and each one renders an accessible data table as its
   text alternative.
3. **Server-rendered images.** No client code, but no interaction, no theme, and an image per
   chart.

## Decision

Option 2. Every new screen is a lazy route.

- **Routes and `WEB_VITALS_ROUTES`:**
  - `/` (the overview; a member sees the template's welcome)
  - `/apps`, `/apps/new`, `/apps/:appId`
  - `/events`, `/events/:eventId`
  - `/apps/:appId/actors/:actorId`
  - `/apps/:appId/resources/:resourceType/:resourceId`
  - `/security`
  - `/alerts`, `/alerts/:alertId`
  - `/response-actions`
  - `/retention`, `/integrity`, `/exports`
  - `/admin/users`, `/admin/users/:userId`, `/admin/invitations`
  - `/account` (with the second factor: status and new recovery codes)

  Plus the template's auth routes. The second factor's step is part of the sign-in, sign-up
  and invitation pages (a lazy component, ADR 0012), not routes of its own. `webVitalsReporter.spec.ts`
  keeps the list and the router equal.

- **Who sees what:** the menu follows the role (members: the welcome and their account; viewers:
  overview, events, security, alerts; auditors add exports; administrators everything). The
  route guards hide what the API would refuse anyway; the pickers list the applications the
  person may see (`GET /api/account/apps`, administrators with Audit Hub's own log too).

- **Budget** (in `performance-budget.json`, measured in the pull request that adds the screens):
  - initial JS stays ≤ 110 kB: the shell and sign-in only. The signed-in frame (`AppLayout`), the
    home page and the users list became lazy routes for it, and so did the step-up dialog
    (fetched the first time a step-up is needed): 109.4 kB measured;
  - a new named budget "Audit pages" covers the lazy chunks of the screens above, the frame and
    the helpers they share: 34.5 kB measured, budgeted at 38 kB;
  - a new budget "Charts" for the shared chart module: 1.5 kB measured, budgeted at 2 kB (well
    under the 8 kB cap);
  - total JS rises by exactly those two amounts, from 160 to 200 kB.

  These are the only budget changes, and this ADR is their justification.

- **Text only:**
  - every value from an event is rendered as a React text node;
  - JSON (details, before and after) goes through a viewer component that builds elements from
    the parsed value;
  - nothing is ever placed in `href`, `src` or `style`;
  - links are built only from ids validated by pattern.

  A component spec, and an E2E spec through ingestion, put `<script>alert(1)</script>`,
  `${alert(1)}`, `" onmouseover="alert(1)` and `javascript:alert(1)` in every field a user can
  see. They assert the exact text is shown and that nothing executes (no dialog, no new node
  outside the text).

- **Data loading:**
  - every list uses cursor pagination (`{ items, nextCursor }`) and keeps its filters in the URL
    (`useSearchParams`), so a view can be shared and reloaded;
  - every chart has one endpoint that answers with a single SQL aggregation (`date_trunc` buckets,
    `generate_series` for empty buckets, a `GROUP BY` of weekday and hour for the heatmap);
  - an integration spec counts the queries per request (Prisma's `query` event, already used for
    slow queries) and asserts the same count for 10 and 10,000 events
    (`apps/api/src/explorer/panel.int.spec.ts`: the overview, security, the explorer and a user's
    activity).
- **Step-up:** a sensitive action answers 403 with `Audit-Error: reauthentication_required`;
  the page sends it through `useStepUp().recent(...)`, which shows the dialog (password and a
  fresh code), steps up and sends it once more. Cancelling leaves the 403 and the page says
  nothing happened.
- **Accessibility:** charts have a title, a description and a table alternative, and are never
  the only way to read a number. The colors come from CSS custom properties that we add to
  `index.css` for light and dark mode (the template has none yet). Filters use the template's
  `TextField` and labelled `select`s.
- **Exports:** the download streams through `fetch` with the in-memory token into a `Blob`, saved
  with an `a[download]`, which needs no CSP change. The exports page lists them with their
  digest (`GET /api/exports`).

## Consequences

- We maintain about five small chart components and their specs. Anything beyond them (maps,
  zoomable timelines) needs a new ADR, not a library slipped in.
- The panel needs no geographic map. Countries show as a ranked list with flags drawn from text
  (ISO codes), which keeps the budget and avoids map data licenses.
- The total-JS budget grows for the first time. The growth is measured and recorded here, and the
  initial budget stays where the template left it.
- We would know this was wrong if the chart components grew into a library of their own, or the
  "Audit pages" budget kept being raised. Then split screens further or reconsider option 1 for one
  lazy chart chunk.

## Update (2026-10-19)

The panel was refined after this decision; the decision stands, and these are its new numbers.

- **The event tables** show each event at a glance (date and time, actor, the action in words,
  application, outcome, risk) and its whole detail in a drawer, a modal dialog fetched with the
  event when a row's details are opened (`EventDrawer`, and `EventView`, shared with the event's
  page). The overview starts with three figures (the log's integrity, open alerts, high-risk
  events in 24 hours) and, for administrators, quick response actions.
- **The alerts** got the same: who each is about by name in the list, and its whole detail in a
  drawer (`AlertDrawer`, and `AlertView`, shared with the alert's page: why it fired in words,
  what its events show, the events, the history by name). Both drawers are one dialog (`Drawer`),
  both views made of the same cards (`DetailParts`).
- **Text only, still:** the JSON viewer shows highlighted code, built from the parsed value, every
  key and string a text node of its JSON form; the table puts no value of an event in an
  attribute (a button is named by its row's text, by id).
- **A member no longer signs in** ([security.md](../security.md#who-may-sign-in)): `/` is the
  overview for everyone who does.
- **Budget:** "Audit pages" covers the drawers' chunks too: 42.1 kB measured, budgeted at 46 kB
  (44.6 kB with the alerts' drawer, within it).
  The template's lazy account and admin pages measured 13.7 kB with the invitation's
  applications, budgeted at 15 kB. The total rises by exactly those two amounts, to 210 kB. The
  signal named above (the budget raised again) was weighed: the growth is new screens the people
  of Audit Hub asked for, each lazy, and the drawer's code loads only when a row's details are
  opened.
