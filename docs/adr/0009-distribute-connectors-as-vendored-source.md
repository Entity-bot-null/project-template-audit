# 0009. Distribute the connectors as vendored source, installed and updated by a command

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Audit Hub maintainers

## Context

The connectors (`audit-nestjs`, `audit-expo`, `audit-web`, and the shared `audit-contract`) are
developed and tested in Audit Hub's monorepo, under `packages/`. They run inside projects created
from project-template-web and project-template-app.

Those projects accept only these dependencies:

- registry packages with sha512 integrity;
- licenses from the allowlist;
- versions at least 7 days old (`minimumReleaseAge`; exceptions only per exact version and with
  an expiry date);
- `trustPolicy: no-downgrade`;
- `blockExoticSubdeps`.

`link:`, `file:`, git and tarball sources fail `pnpm deps:check`. The app's Jest config doesn't
transform a package named `@scope/audit-expo` (checked), so a registry package would have to
ship compiled CommonJS. And the connector must pass each project's own gates as if it were the
project's code:

- lint: import boundaries, no `process.env`, no `fetch` outside `src/api`;
- coverage: API 95/91/87/94, app 97/96/94/90;
- bundle budgets.

Connecting a new project must take under 30 minutes, and in phase F9 both templates must ship
with the connector installed and turned off.

## Options

1. **Private registry packages (GitHub Packages)**, published from CI with provenance.
   - Pros: versioned; Dependabot proposes updates.
   - Con: GitHub Packages requires authentication even to read. Every project, **and every
     project created from the templates even if it never connects**, would need a token to run
     `pnpm install`. This would make it worse to create a project from the templates.
   - Con: every fix waits 7 days, or needs a dated exception.
   - Con: the Expo package must ship compiled CommonJS for Jest.
   - Con: the project's lint and coverage don't see its code.
2. **Public packages on npmjs.org** (the code holds no secret, under an allowed license), published
   from CI with provenance through trusted publishing.
   - Pros: no token is needed, and Dependabot works.
   - Cons: the 7-day wait, compiled output for Jest, and code invisible to the project's own
     gates, as in option 1.
   - Con: publishing the organization's internal security tooling publicly is a decision of its
     own.
3. **Vendored source, installed by a command** (shadcn-style "add").
   - The connector's source and its tests are copied into the project:
     - `apps/api/src/audit/` for the API;
     - `src/lib/audit/` plus small adapters in `src/api/` and `src/lib/storage/` for the app;
     - `apps/web/src/audit/` for the SPA.
   - A manifest `audit-connector.json` records the connector version, the contract version and the
     SHA-256 of each pristine file.
   - Pros: the files are then the project's own code. Its lint, types, coverage and SAST cover
     them; the reviewers read them; there is no registry, token, delay, trust policy or Jest
     transform involved.
   - Con: updates need a command that shows the diff and merges local edits (a 3-way merge
     against the pristine copy of the installed version).

## Decision

Option 3.

- **Source of truth:** `packages/audit-*` in Audit Hub.
  - Each package is written for its host's conventions. For example, ESM with `.js` import
    extensions for the NestJS API; extensionless bundler imports and no color literals for Expo.
  - Its specs use only `describe`, `it`, `expect` and injected fakes (no `vi.mock` or
    `jest.mock`), so the same files run under Vitest in Audit Hub and under Jest in the app.
  - Ports keep each package independent of its host: transport, storage, lock, clock and push are
    implemented by small adapter files that the installer creates once and never overwrites. The
    host's own services are wired there: `PrismaService`, `LockService`, `createExternalHttpClient`,
    the `api` client, `src/lib/storage`.
- **Package names:** unscoped and private, like the template's own `api` and `web`:
  `audit-contract`, `audit-nestjs`, `audit-expo` and `audit-web`. They are never published, so
  they need no registry scope. If one is published one day (option 2), it gets a scope then.
- **Installer:** `pnpm connector add|status|diff|update --target <project> --kind api|expo|spa`,
  a script of Audit Hub (`scripts/connector.mjs`) run from a checkout at a release tag.
  - `add` copies the files, writes the manifest and prints the remaining steps: variables,
    `pnpm db:migrate`, wiring.
  - `status` and `diff` show local edits and the available version.
  - `update` applies the new version with `git merge-file` against the pristine copy of the
    installed version, leaves conflict markers where both sides changed, and never touches the
    adapters.
  - The pristine copies live in the project, under `.audit-connector/pristine/<path>.orig`, and
    are committed with it: a merge never depends on a checkout of the version the project
    installed.
  - `migration` writes the connector's migration from the schema alone
    (`prisma migrate diff --from-schema <without the connector> --to-schema <with it>`), so no
    database is needed and an applied migration is never edited.
  - A connector is installed into the directory of the app it serves, each with its manifest:
    the API's at the project's root, the SPA's in `apps/web` (`--target <project>/apps/web`).
    An example's pin lists both (`examples/web/template.json`).
  - The Expo kind gets the part of the contract it imports, with the specs that cover it
    (`EXPO_CONTRACT_FILES`, import-closed: `connector.test.mjs` checks it): the app's coverage
    counts every file under `src/`. Its copy has extensionless imports, specs without their
    `vitest` import (Jest's globals are the same three) and an index of its own; the queue's SQL
    runs in the specs on Node's own SQLite (`node:sqlite`), which both runners load.
  - A version that changes the connector's tables makes `update` refresh the models block and
    write an incremental migration (`<stamp>_update_audit_connector`: `prisma migrate diff`
    from the schema before to the schema after). What Prisma cannot express (check
    constraints) is versioned SQL in the package, `install/api/prisma/sql/<version>.sql`,
    appended for each version after the installed one. Without the project's Prisma installed,
    `update` refuses before touching anything, so files and tables never disagree.
- **The project's schema:** the connector's models go between `// audit-connector:begin` and
  `// audit-connector:end` in `schema.prisma`. Prisma requires every relation on both sides, so
  `add` also writes one line in `model User`, marked `// audit-connector`; it is the only edit the
  installer makes to one of the project's own models, and `update` and the schema diff recognise
  it by its marker.
- **Adapters (API):** `host.ts`, `audit.wiring.ts`, `app-catalog.ts` and `audit.int.spec.ts`
  (the integration spec of the wiring, against the project's database and a local Audit Hub that
  verifies every signature). The flows of the template are recorded by edits to the project's own
  services, guards and specs, listed in `docs/audit/connection-guide.md#integration-points`; the
  example projects (ADR 0010) carry them.
- **The catalog's version** is the hash of the catalog document (the application, its actions,
  its response actions), not the project's release: it changes only when an action does, and the
  forwarder stamps it on each event when sending, so events queued before a deployment go with the
  catalog Audit Hub knows.
- **Templates (F9):** both templates get the connector installed and off (no variables means no
  queue writes, no worker, no routes registered beyond the ones that answer `404`/`disabled`), so
  a new project only needs its variables. They get it through their template patches
  (`examples/<kind>/template-patch/`, ADR 0010), which their owner applies; the generated examples
  prove them, then bring the connector they ship to the current version with `connector update`.
- **Compatibility window:** Audit Hub accepts the current and the previous contract versions
  (ADR 0005), so projects update the connector on their own schedule, and the heartbeat tells
  them when they fall behind.

## Consequences

- Connecting a project created from an updated template takes these steps:
  1. register the app in Audit Hub's wizard;
  2. paste the variables;
  3. redeploy;
  4. check the wizard's "connection test" (signed ping, catalog, heartbeat).

  That is well under 30 minutes. An older project adds `pnpm connector add` and one migration.

- A connector fix reaches projects as quickly as they run `pnpm connector update` and merge. No
  registry delay applies, so the speed is up to each team, and Audit Hub shows the connector
  version of every app with a warning when it is outdated.
- Copies can drift. `status` makes local edits visible, and a project can add
  `pnpm connector status --check` to its CI to fail on unexplained edits.
- Audit Hub's CI must prove that the vendored code passes the hosts' gates. That is the job of the
  generated example projects (ADR 0010).
- We would know this was wrong if teams kept diverging from the pristine code, or found merges
  painful. Then move to option 2 for `audit-contract` and `audit-nestjs` first: they are the
  simplest to package, with no Jest transform involved.
