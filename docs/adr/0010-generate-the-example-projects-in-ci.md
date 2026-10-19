# 0010. Generate the connected example projects in CI from pinned template commits

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

The connectors' acceptance criteria run on real projects:

- a business rollback sends nothing;
- an Audit Hub outage loses nothing;
- a forged `X-Forwarded-For` changes nothing;
- the project without variables still passes all its gates;
- airplane mode, sign-out between users, the shared `request_id`, "Was it you?" from end to end.

Those real projects are the templates plus the connector. They have their own lockfiles,
`pnpm-workspace.yaml` settings, coverage thresholds and budgets. Putting them inside Audit Hub's
pnpm workspace would mix those policies, and committing full copies would duplicate two
repositories that keep changing.

## Options

1. **Committed copies under `examples/`**, inside or outside the workspace. Everything is visible,
   but there are two large trees to keep in step with the templates by hand, and they go stale
   silently.
2. **Git submodules** pointing at the templates, plus a patch. This is an exotic source for some
   tools, needs authentication in CI if the templates are private, and makes awkward clones.
3. **Generated in CI.**
   - `examples/<kind>/template.json` pins the template repository and a commit SHA.
   - `examples/<kind>/overlay.patch` holds what the example adds on top of the installed
     connector, as a binary git diff:
     - the integration points, as described in the connection guide;
     - for the app, the routes the API's connector adds, in its contract and its mock API, with
       controls for the flows (a "Was it you?" question, what the app sent);
     - its lockfile, when the connector adds dependencies (the API's adds none; the app's adds
       `expo-crypto`, and `expo-location` for the optional location).
   - `scripts/examples.mjs generate` clones at the pinned SHA into `.examples/<kind>/` (ignored by
     git) on a branch `example`, runs `pnpm connector add`, installs, writes the migration,
     commits that as the base, then applies the overlay. `scripts/examples.mjs save` writes the
     overlay back from the generated project (`git diff --binary` against the base, new files
     included), so it is edited where it runs and saved, never by hand.

## Decision

Option 3. `examples/` contains only the pins, the overlays and the cross E2E specs; generated projects live
in `.examples/`, outside Audit Hub's workspace, each installed with its own lockfile and its own
`pnpm-workspace.yaml`.

- **CI job `examples-web`** (on every pull request that touches `packages/audit-contract`,
  `packages/audit-nestjs`, `packages/audit-web`, `apps/api/src/ingest` or `examples/web`):
  1. generate the project;
  2. run its `pnpm verify` and `pnpm test:integration` with its thresholds untouched, both without
     any Audit Hub variables and with them;
  3. run the cross E2E: Audit Hub and the example started together, a Playwright suite in
     `examples/web/e2e/` that drives the acceptance criteria.
- **CI job `examples-app`:**
  1. generate the project;
  2. run its `pnpm verify` (format, lint, typecheck, Jest with its thresholds, `expo-doctor`, the
     supply-chain gates, `build:check` with the bundle budgets).
- **CI job `examples-app-e2e`**, slower, in the same workflow: the template's own Android E2E
  (a release build of its E2E variant on an emulator, its mock API), with the connector's flows
  added: the device's events waiting for the API and sent once it answers, sign-out between two
  users, and "Was it you?" answered yes and then no.

  The app example runs against the template's mock API, extended with the routes the API's
  connector adds, not against the web example's API: the two templates have different sample
  contracts (the app's items, the web's sign-in cookies). The shared contract keeps both sides in
  step: the app's `openapi.json` gets the connector's routes as the web example's API exports
  them, and both validate with `packages/audit-contract`.

  An offline API is the mock's fault on the events route (no answer at all), not airplane mode:
  `adb reverse` keeps the mock reachable over the debugging connection. The template's emulator
  image has no Google Play services, so a push cannot arrive there: the flow opens the
  notification's link (`maestro openLink`) exactly as a tap would, and the push delivery itself is
  covered by the API connector's specs of the Expo sender and by a manual step on a device in the
  release checklist.

- **Bumping a pin** is a pull request: it shows the template diff and runs everything above.
  Dependabot can't do it; a scheduled workflow opens that pull request every week.
- **Template patches (F9):** the changes that make each template ship the connector installed and
  off, and fill the template gaps the design lists, are `git format-patch` series under
  `examples/<kind>/template-patch/`, in this repository, one commit each, every one passing the
  template's own gates. The generator applies them (`git am`) right after the clone, brings each
  connector they install to the current version (`connector update`), then commits the base; so
  CI proves them on every run, and the update path too. `pnpm examples save` writes them back
  (`git format-patch` of the commits between the pin and the base, without commit ids or the git
  version, so an unchanged series gives the same files): to change a patch, rewrite its commit in
  the generated example. They are never applied to, committed to or pushed to the template
  repositories by an agent: their owner applies them (`git am examples/<kind>/template-patch/*`).
- **Pins:**
  - web: `Entity-bot-null/project-template-web` @ `8d52b7b3648f97623c091c5607c13a2409f23bd6`;
  - app: `Entity-bot-null/project-template-app` @ `d914c7c2c86b67c72e74328dbd9178f17923de74`.

  Locally, `EXAMPLES_<KIND>_TEMPLATE=<path>` clones from a checkout on disk instead of GitHub; that
  checkout is only read.

## Consequences

- CI needs read access to both template repositories. If they are private, a fine-grained,
  read-only token goes in an environment secret, and the workflow declares it with its reason
  (template rule on workflow permissions).
- The `examples-app` job installs an Expo project: a few minutes, and a cache keyed on its
  lockfile. Maestro runs on a schedule and on demand, not on every pull request.
- A template change that breaks the connector shows up when the pin is bumped, never by surprise
  in an unrelated pull request.
- We would know this was wrong if overlays grew into a fork of the templates. Then the
  integration points they carry belong in the templates themselves (F9) and the overlay shrinks
  back to variables.
