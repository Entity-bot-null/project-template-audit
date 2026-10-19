# Manual

Versión en español: [manual.es.md](manual.es.md). Both versions describe the same steps and
commands; a change to one goes to the other in the same pull request.

Audit Hub is a self-hosted audit-log and security service. The applications you connect send it
their security, audit, access and system events, signed, through a connector installed in each of
them. Audit Hub keeps the events append-only and sealed, with retention and erasure, runs
detection rules on them, raises alerts, and gives administrators, auditors and viewers their own
pages; every account signs in with a password and an authenticator app (TOTP).

This manual is for the operator who runs an Audit Hub instance for their company, and for the
developers who change it. It explains how to install, run, operate and change Audit Hub, from an
empty machine to an instance running in production, with every command it ships. Each step says
what to run, what it does and what you should see. The other pages in `docs/` hold the reasoning
and the details; this one is the path through them. Connecting an application:
[audit/connection-guide.md](audit/connection-guide.md). The legal documents (the processor
contract, the paragraphs of the privacy notice, the ARCO procedure): [privacy/](privacy/README.md).

Conventions:

- Commands run from the repository root unless a step says otherwise. On Windows use **Git Bash**
  (installed with Git for Windows): every command here is written for it.
- `<angle brackets>` are values you replace. `OWNER/REPO` is your GitHub repository.
- **REQUIERE CONFIGURACIÓN** marks a step only your instance can complete (a provider, an account,
  a decision); Audit Hub prepares it but cannot do it for you.
- `pnpm <script>` runs a root script; `pnpm --filter api <script>` and `pnpm --filter web <script>`
  run a script of one app.

## Contents

1. [Before you start](#1-before-you-start)
2. [Set up Audit Hub](#2-set-up-audit-hub)
3. [Daily development](#3-daily-development)
4. [Tests](#4-tests)
5. [Commits, pushes and pull requests](#5-commits-pushes-and-pull-requests)
6. [Configuration](#6-configuration)
7. [Command reference](#7-command-reference)
8. [CI/CD](#8-cicd)
9. [Releases](#9-releases)
10. [Deploying and rolling back](#10-deploying-and-rolling-back)
11. [Optional infrastructure](#11-optional-infrastructure)
12. [Running in production](#12-running-in-production)
13. [Maintenance calendar](#13-maintenance-calendar)
14. [When something fails](#14-when-something-fails)
15. [Appendix: ports, accounts, files](#15-appendix-ports-accounts-files)

## 1. Before you start

### 1.1 Install the tools

| Tool                   | Version                                     | Check                    | Notes                                                                                                                   |
| ---------------------- | ------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Node.js                | 24.15 or later, or 26+ (`.nvmrc`: 24)       | `node --version`         | nvm (`nvm install 24 && nvm use`), fnm (`fnm use`), Volta or the official installer. Older versions are refused.        |
| pnpm                   | 12.5.1 (`packageManager` in `package.json`) | `pnpm --version`         | `corepack enable` once, and Node's Corepack provides the exact version. Without Corepack: `npm install -g pnpm@12.5.1`. |
| Docker with Compose v2 | any current                                 | `docker compose version` | Docker Desktop (Windows, macOS) or Docker Engine (Linux). Needed for the database, the images and the security tools.   |
| Git                    | any current                                 | `git --version`          | Windows: Git for Windows, which brings Git Bash and `openssl`.                                                          |
| openssl                | any                                         | `openssl version`        | Generates secrets. Without it: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.         |
| GitHub CLI (optional)  | any current                                 | `gh --version`           | Only for the repository settings in [2.9](#29-set-up-github); everything can also be done in the web UI.                |

Disk: the development database image is small; the production images take about 1 GB each, the
optional local observability backend about 3.7 GB and the DAST scanner about 3.7 GB.

### 1.2 Windows notes

- If `pnpm db:up` fails with "port is already allocated" or "bind failed", Windows often reserves
  the database's port (5452): use another port ([2.4](#24-create-the-environment-files)).
- Git Bash rewrites paths that start with `/` when it passes them to `docker`. Prefix such commands
  with `MSYS_NO_PATHCONV=1` (shown where needed).
- Docker Desktop must be running before any command that uses Docker.

## 2. Set up Audit Hub

Once per instance (a developer's machine too), in this order.

### 2.1 Get the code

Audit Hub's repository is private for now: ask its owner for access to
`<Audit Hub repository URL>`. Each instance needs a GitHub repository of its own, where its CI, its
images and its deployments run ([2.9](#29-set-up-github)). Either fork it on GitHub into your
organization (a fork of a private repository is private too) and clone the fork, or clone it:

```
git clone <Audit Hub repository URL> audit-hub
cd audit-hub
```

Keep its history: `CHANGELOG.md` and the version (`.release-please-manifest.json`) continue from
it, and `git log` still says where each change came from.

### 2.2 Fill in your contacts (REQUIERE CONFIGURACIÓN)

| Where                | What to change                                                                        |
| -------------------- | ------------------------------------------------------------------------------------- |
| `SECURITY.md`        | the private contact for vulnerability reports, and the response times if yours differ |
| `.github/CODEOWNERS` | real users or teams instead of the placeholders, uncommented                          |
| `README.md`          | the title and the first paragraph, only if you rebrand Audit Hub                      |

Everything else stays as it is: the package names, the page and API titles, `CHANGELOG.md` and the
version are Audit Hub's. The contacts of the incident runbooks and the placeholders of the privacy
documents come later ([2.8](#28-decisions-for-your-instance-requiere-configuración),
[2.10](#210-before-the-first-production-release)).

### 2.3 Install

```
corepack enable        # once per machine (Node.js 25+: npm install -g corepack first)
pnpm install
```

This installs every app, generates the Prisma client (`prisma generate`) and installs the Git hooks
(Husky sets `core.hooksPath`). It refuses Node.js versions outside `engines`, packages published
less than seven days ago, and new install scripts that are not reviewed
([14](#14-when-something-fails) lists the messages).

### 2.4 Create the environment files

```
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32
```

Paste the printed value as `JWT_ACCESS_SECRET=` in `apps/api/.env`. That is the only value the API
needs to start locally; the file documents every other variable. It already points email at the
local Mailpit ([11.5](#115-email)); delete `MAIL_SMTP_URL` to run without it.

The root `.env` is read by Docker Compose. Create it when you need one of its settings:

```
cp .env.example .env
```

- **Port 5452 taken:** the database uses 5452 rather than PostgreSQL's 5432, so it does not collide
  with a PostgreSQL installed on the machine. If 5452 is taken too: `DB_PORT=5443` in the root
  `.env`, and the same port in `DATABASE_URL` of `apps/api/.env`
  (`postgresql://app:app@localhost:5443/app`).
- **The production-like stack** ([2.7](#27-check-that-every-gate-passes)): `JWT_ACCESS_SECRET`,
  `AUDIT_SECRETS_KEY` and `AUDIT_INTEGRITY_KEY` in the root `.env` too (an `openssl rand -hex 32` each).
- **Ports 1045 or 8045 taken** (Mailpit's SMTP and web UI; not its usual 1025 and 8025, which
  another project's Mailpit may hold): `MAILPIT_SMTP_PORT` and `MAILPIT_UI_PORT` in the root
  `.env`, and the SMTP port in `MAIL_SMTP_URL` of `apps/api/.env`.
- **Local Redis** ([11.1](#111-redis)): `REDIS_PASSWORD` in the root `.env`
  (`openssl rand -hex 24`, pasted as the value).

`apps/web/.env.example` lists the web app's optional settings; none is needed.

Never commit a `.env` file: `.gitignore`, the pre-commit hook and the secret scans refuse them.

### 2.5 Create the database

```
pnpm db:up        # PostgreSQL 18 in Docker, on 127.0.0.1 only, data in the volume db_data
pnpm db:migrate   # applies every migration, regenerates the Prisma client
pnpm db:seed      # development accounts (public passwords; refuses any non-local database)
```

The seed prints the accounts, one per role: `admin@example.com` / `admin-password`,
`auditor@example.com` / `auditor-password`, `viewer@example.com` / `viewer-password` and
`member@example.com` / `member-password`, and their second factor: add the key
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` to an authenticator app ("enter a key", time-based) and type its
code after the password. It is idempotent: run it again whenever you want them back. The auditor
and the viewer sign in once they see an application (`pnpm dev:demo`, [2.6](#26-run-it), assigns
them its applications); the member never does: it shows the refusal
([11.7](#117-audit-hub-two-step-verification-access-and-exports)).

### 2.6 Run it

```
pnpm dev
```

It starts the database and Mailpit (`pnpm services:up`, if stopped), then the API and the web app
with live reload, and prints these addresses in a box under their logs, again after every restart:

| What                        | URL                                             |
| --------------------------- | ----------------------------------------------- |
| Web app                     | http://localhost:5273                           |
| API                         | http://127.0.0.1:3200/api                       |
| API documentation (Swagger) | http://localhost:3200/api/docs                  |
| API liveness / readiness    | http://127.0.0.1:3200/api/health/live, `/ready` |
| Email the API sent          | http://localhost:8045 (Mailpit)                 |

Open the web app and sign in with a seeded account and the code of your authenticator app (or
the one `pnpm dev:totp` prints). The API's first log line says what is on:
`Starting release unversioned in development: tracing and metrics off, error tracking off, Redis off, email on`.

The admin pages are empty until applications send their audit logs. `pnpm dev:demo` fills them,
through Audit Hub's real interfaces: it registers three applications (as the seeded administrator),
sends three weeks of their activity (the alerts it would have raised over those weeks already
reviewed), and stages a few attacks now, so the alerts appear (some at once, the rest within five
minutes). It also assigns those applications to the seeded auditor and viewer, so they can sign
in. Run it once, with `pnpm dev` running; a second run changes nothing else (it gives the seeded
auditor and viewer the demo's applications again if they lost them).

Stop with `Ctrl+C`. `pnpm db:down` removes the database and Mailpit containers; the database's data
stays in its Docker volume (Mailpit's messages do not), and the optional services keep running
until `docker compose --profile <profile> down`.

### 2.7 Check that every gate passes

Run once now, so you know the machine is set up like CI:

```
pnpm verify                              # format, lint, types, unit tests + coverage, security, build, budget
pnpm test:integration                    # API against PostgreSQL (and Redis, if configured)
pnpm exec playwright install chromium    # once per machine
pnpm test:e2e                            # browser tests on the built app (needs pnpm build, done by verify)
pnpm test:scripts                        # tests of the repository scripts (Semgrep file selection, Doberman)
pnpm sast                                # Semgrep (Docker; a few minutes, see 14)
pnpm lint:workflows                      # actionlint + zizmor + shellcheck (Docker)
pnpm observability:check                 # dashboards and alert rules, promtool tests (Docker)
pnpm iac:check                           # Terraform, TFLint, Trivy, cloud-init, database roles (Docker)
docker compose --profile stack up --build   # production images at http://localhost:8180
```

For the last one, the root `.env` needs `JWT_ACCESS_SECRET`, `AUDIT_SECRETS_KEY` and `AUDIT_INTEGRITY_KEY`. In another terminal:
`pnpm smoke --url http://localhost:8180` should end with `Smoke test passed (public URL only).`
Stop it with `Ctrl+C`, then `docker compose --profile stack down`.

### 2.8 Decisions for your instance (REQUIERE CONFIGURACIÓN)

Take them before production; the step-by-step guide's worksheet collects the answers
([phase 0](step-by-step.md#phase-0-information-and-decisions)).

- **The applications to connect**, and in which environments: one application per backend and
  per environment ([Which applications to register](audit/connection-guide.md#which-applications-to-register)).
- **Who signs in:** the administrators (two at least: nobody resets their own second factor, and a
  response action needs a second administrator's approval by default), the auditors and viewers,
  and the applications each auditor or viewer sees ([11.7](#117-audit-hub-two-step-verification-access-and-exports)).
  People come by invitation (with email, [11.5](#115-email)), with their role and, for auditors
  and viewers, their applications; every account sets up its authenticator app at its first
  sign-in. There is no public sign-up: `SIGN_UP_ENABLED=true` stops the boot.
- **Retention per application:** the minimums, which are also the defaults (security 730 days,
  audit 365, access 180, system 30, audit access 730, personal data 90, coordinates 30:
  [database.md](database.md#audit-hubs-audit-tables)), or longer where a client's contract or a
  law asks for it (Retention, in the admin pages).
- **Alert channels:** email to the administrators and auditors ([11.5](#115-email)), a Slack
  channel or a Teams workflow ([11.6](#116-audit-hub-alert-notifications-and-ip-geolocation)), and
  who reads them.
- **IP geolocation** (optional): the DB-IP Lite files, downloaded every month
  ([11.6](#116-audit-hub-alert-notifications-and-ip-geolocation),
  [deploy-vps.md](deploy-vps.md#ip-geolocation)); without them the country, travel and hosting
  rules do not run.
- **Where the integrity checkpoint digests are kept:** outside Audit Hub, out of reach of whoever
  holds its database and `AUDIT_INTEGRITY_KEY`
  ([security.md](security.md#audit-log-integrity-retention-and-erasure)). A checkpoint is made
  every day; the Integrity page shows the last one, and `audit checkpoint` makes one now
  ([7.2](#72-api-scripts-pnpm---filter-api-script)).
- **The legal role** ([privacy/README.md](privacy/README.md#roles)): running Audit Hub for other
  companies' applications, you are their processor (encargado) and each of them is the controller
  (responsable), with a [processor contract](privacy/processor-contract.md) for each one; running
  it for your own company's applications, that contract becomes an internal policy. For Audit
  Hub's own users you are the controller, with a privacy notice of your own. Each connected
  application adds the paragraphs of [privacy-notice.md](privacy/privacy-notice.md) to its notice.
  Counsel reviews every document before it is used.
- **Optional integrations:** Redis (more than one API instance), Sentry, OpenTelemetry
  ([11](#11-optional-infrastructure)).

For the developers who change Audit Hub:

- The detection rules' thresholds (`apps/api/src/rules/rules.constants.ts`) are starting points,
  tuned with real traffic in a reviewed change ([security.md](security.md#detection-rules)).
- Coverage thresholds and the performance budget stay as floors; adjust them deliberately
  ([testing.md](testing.md#coverage)).
- The license policy for dependencies (`scripts/dependency-policy.json`), if the way Audit Hub is
  distributed needs a stricter or looser one.
- `docs/template/` keeps the history of the web template Audit Hub started from.

### 2.9 Set up GitHub

The first commit and the only direct push to `main` the repository ever gets from you (the
pre-push hook refuses any other):

```
git add -A
git commit -m "chore: set the security contact and code owners"
git remote rename origin upstream
git remote add origin <your repository URL>
git push --no-verify -u origin main
```

The commit runs the pre-commit hook on the files you changed. The two `git remote` lines keep
Audit Hub's repository as `upstream` and point `origin` at yours; with a fork, `origin` is your
fork already: skip them, and enable the fork's workflows in its **Actions** tab (GitHub leaves
them off in a fork).

Then the repository settings (REQUIERE CONFIGURACIÓN), in the web UI or with `gh`:

| Setting                                                                                             | Where / command                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Squash merge only, default message = pull request title, delete branches after merge                | Settings → General → Pull Requests                                                                                                                                         |
| Ruleset for `main`: pull requests, **CI passed** and **Conventions**, code owners, no force push    | `gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/main.json` (public repository or paid plan)                                                       |
| Release tags `v*` immutable                                                                         | `gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/tags.json`                                                                                        |
| Read-only default token for workflows                                                               | Settings → Actions → General → Workflow permissions → Read repository contents; tick "Allow GitHub Actions to create and approve pull requests" (the release pull request) |
| Environments `staging` and `production`, deployment branches "`main` only", reviewers on production | Settings → Environments                                                                                                                                                    |
| Optional token for release pull requests (every pull request workflow runs on them)                 | `gh secret set RELEASE_PLEASE_TOKEN` (a GitHub App token or a fine-grained token: contents, pull requests, issues)                                                         |
| Registry for the images                                                                             | `gh variable set IMAGE_PREFIX --body ghcr.io/OWNER/REPO`                                                                                                                   |
| Passive DAST of staging, once it exists                                                             | `gh variable set DAST_STAGING_URL --body https://<staging host>`                                                                                                           |
| CodeQL, dependency review (public repository or GitHub Advanced Security)                           | `gh variable set ENABLE_CODEQL --body true`, `gh variable set ENABLE_DEPENDENCY_REVIEW --body true`                                                                        |
| Dependabot alerts and security updates, private vulnerability reporting, push protection            | Settings → Code security                                                                                                                                                   |
| Deployment secrets of an environment                                                                | `gh secret set <NAME> --env production` (or the platform's secret store)                                                                                                   |

Details and reasons: [ci-cd.md](ci-cd.md#repository-settings-requiere-configuración).

### 2.10 Before the first production release

Go through [production-readiness.md](production-readiness.md): backups and a restore drill, alerts
and SLOs, the deployment job, the contacts of the incident runbooks. [10](#10-deploying-and-rolling-back)
and [12](#12-running-in-production) below walk through them. Audit Hub adds its own: the keys
(`AUDIT_SECRETS_KEY`, `AUDIT_INTEGRITY_KEY`) in the secret store, the checkpoint digests kept
outside, the retention policies set, a test application connected end to end, the alert channels
tested, and the privacy documents reviewed by counsel
([step-by-step.md](step-by-step.md#phase-11-before-real-users)).

## 3. Daily development

### 3.1 Start the day

```
git switch main
git pull
pnpm install          # when pnpm-lock.yaml changed
pnpm db:migrate       # when apps/api/prisma/migrations/ changed
pnpm dev
```

If `apps/api/.env.example` gained a variable, copy it into your `apps/api/.env`. If the editor shows
old types after a pull, run "TypeScript: Restart TS Server" (VS Code).

### 3.2 Start a change

1. The issue meets the [Definition of Ready](definition-of-ready.md) (the feature template asks for
   each item).
2. A branch from an up-to-date `main`, named `<type>/<description>`:

   ```
   git switch -c feat/ABC-123-user-invitations
   ```

   Types: `feat`, `fix`, `hotfix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`,
   `release`. Check a name with `node scripts/check-branch-name.mjs <name>`.

### 3.3 Make the change

Step-by-step recipes with code that passes every gate, in [how-to.md](how-to.md):

| Change                                        | Recipe                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A table or a column                           | [Add a table or a column](how-to.md#add-a-table-or-a-column)                               |
| A new API resource                            | [Add an API module](how-to.md#add-an-api-module)                                           |
| One more route                                | [Add an endpoint](how-to.md#add-an-endpoint-to-an-existing-module)                         |
| A contract change                             | [Change the API contract](how-to.md#change-the-api-contract)                               |
| A screen                                      | [Add a screen](how-to.md#add-a-screen-to-the-web-app)                                      |
| A browser test                                | [Add an end-to-end test](how-to.md#add-an-end-to-end-test)                                 |
| A configuration value                         | [Add an environment variable](how-to.md#add-an-environment-variable)                       |
| A role                                        | [Add a role](how-to.md#add-a-role)                                                         |
| A dependency                                  | [Add a dependency](how-to.md#add-a-dependency)                                             |
| A cached read                                 | [Cache a read](how-to.md#cache-a-read)                                                     |
| A call to a third-party API                   | [Call an external service](how-to.md#call-an-external-service)                             |
| A job on one instance, a message handled once | [Run a job on one instance](how-to.md#run-a-job-on-one-instance-or-process-a-message-once) |
| Another app or a worker                       | [Add another app](how-to.md#add-another-app-or-a-background-worker)                        |

The rules every change follows: [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md).

### 3.4 Change the API contract

Contract first: write the Zod schemas and the controller signatures, then

```
pnpm contract
```

It regenerates the JSON Schemas of the integration contract (`packages/audit-contract/schema/v1`,
from its Zod schemas), exports `openapi/openapi.json` from the code and regenerates
`apps/web/src/api/schema.d.ts`. Review the diffs, commit the generated files, never edit them by
hand. Swagger UI shows the
result at http://localhost:3200/api/docs while `pnpm dev` runs ([openapi/README.md](../openapi/README.md)).

### 3.5 Change the database

1. Edit `apps/api/prisma/schema.prisma`.
2. Create and apply the migration, and regenerate the client:

   ```
   pnpm db:migrate --name add_invitations
   ```

3. Read the generated SQL in `apps/api/prisma/migrations/<timestamp>_add_invitations/migration.sql`:
   locks on large tables, defaults, data loss warnings.
4. Keep it compatible with the version running now (expand and contract) and follow the safe
   migration rules: [database.md](database.md#safe-migrations).

Other database commands:

| Command                                        | What it does                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm --filter api exec prisma migrate status` | which migrations are applied to the database in `DATABASE_URL`                 |
| `pnpm --filter api db:deploy`                  | `prisma migrate deploy`: applies pending migrations, never creates one         |
| `pnpm --filter api exec prisma migrate reset`  | **development only**: drops the database, re-applies every migration           |
| `pnpm --filter api exec prisma generate`       | regenerates the client (the dev, lint, typecheck and test commands already do) |
| `pnpm --filter api exec prisma studio`         | a browser UI over the development database                                     |
| `docker compose exec db psql -U app -d app`    | a SQL shell in the development database                                        |

Never edit a migration that reached `main`; fix forward with a new one.

### 3.6 Before you push

```
pnpm verify
```

It runs, in order and stopping at the first failure: format check, lint, typecheck, unit and
component tests with coverage, `pnpm security` (dependency audit, dependency policy, secret scan),
build, performance budget. Also run `pnpm test:integration` when the API changed and
`pnpm test:e2e` when a user flow changed. Quick fixes:

```
pnpm format        # rewrites files to the Prettier style
pnpm lint:fix      # applies ESLint's automatic fixes
```

## 4. Tests

| Kind                    | Command                                                             | Needs                                          | Files                                   |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| Unit and component      | `pnpm test`                                                         | nothing                                        | `*.spec.ts`, `*.spec.tsx`               |
| With coverage           | `pnpm test:coverage`                                                | nothing                                        | reports in `apps/*/coverage/index.html` |
| Watch mode              | `pnpm --filter api test:watch`, `pnpm --filter web test:watch`      | nothing                                        |                                         |
| One file                | `pnpm --filter api exec vitest run src/users/users.service.spec.ts` | nothing                                        |                                         |
| Integration             | `pnpm test:integration`                                             | `pnpm db:up`; Redis optional                   | `apps/api/src/**/*.int.spec.ts`         |
| End-to-end              | `pnpm test:e2e`                                                     | `pnpm db:up`, `pnpm build`, Chromium installed | `e2e/*.e2e.ts`                          |
| End-to-end, interactive | `pnpm exec playwright test --ui`                                    | the same                                       |                                         |
| One end-to-end test     | `pnpm exec playwright test --grep "keeps members out"`              | the same                                       |                                         |
| Last end-to-end report  | `pnpm exec playwright show-report`                                  | a previous run                                 | `playwright-report/`                    |

- **Integration tests** create and migrate `<db>_test` on the server of `DATABASE_URL`, never touch
  the development database, and run one file at a time.
- **Redis specs** run when a Redis URL is set: start Redis ([11.1](#111-redis)) with `REDIS_URL` in
  `apps/api/.env`, or pass it for one run: `REDIS_TEST_URL=redis://:<password>@127.0.0.1:6389 pnpm test:integration`.
  Without one they are skipped locally; `CI=true` makes them mandatory, as in CI.
- **End-to-end tests** use `<db>_e2e` (reseeded every run), the built API on port 3300 and the built
  web app on 4273: stop anything else on those ports.

How to write tests, mocks, fixtures and the coverage ratchet: [testing.md](testing.md).

## 5. Commits, pushes and pull requests

### 5.1 Commit

```
git add <files>
git commit -m "feat(api): paginate the user list"
```

The message is a Conventional Commit: `<type>(<optional scope>): <summary>`, types `feat`, `fix`,
`perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`; `!` and a
`BREAKING CHANGE:` footer for breaking changes ([commits.md](commits.md)). Check a message without
committing: `printf 'feat(api): paginate the user list\n' | pnpm exec commitlint`.

The hooks run by themselves:

| Hook         | Runs                                                                                                                             | Takes          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `pre-commit` | on the staged files: refuses `.env` files, secretlint, `eslint --fix`, `prettier --write`, the contract-step check of migrations | seconds        |
| `commit-msg` | commitlint                                                                                                                       | under a second |
| `pre-push`   | refuses pushes to `main`/`master` and badly named branches, then `pnpm typecheck` and `pnpm test`                                | about 30 s     |

`--no-verify` skips them: only for the first push of a new repository or a real emergency, said in
the pull request ([git-hooks.md](git-hooks.md)). CI runs the same checks anyway.

### 5.2 Push and open the pull request

```
git push -u origin HEAD
gh pr create --fill        # or open it on GitHub
```

- Fill in the pull request template; its title is a Conventional Commit (it becomes the commit on
  `main` and the changelog line).
- Wait for **CI passed** and **Conventions** ([8](#8-cicd)); read a failure in the job's log and
  fix it on the branch.
- Get a review ([code-review.md](code-review.md)), answer every comment.
- Squash merge, delete the branch. The change is done when the
  [Definition of Done](../DEFINITION_OF_DONE.md) holds.

## 6. Configuration

### 6.1 Where configuration lives

| File                    | Read by                                                   | Committed |
| ----------------------- | --------------------------------------------------------- | --------- |
| `apps/api/.env`         | the API and the Prisma CLI, development                   | never     |
| `apps/api/.env.example` | documentation of every API variable                       | yes       |
| `.env` (root)           | Docker Compose: ports, the stack's secret, Redis password | never     |
| `.env.example` (root)   | documentation of the Compose variables                    | yes       |
| `apps/web/.env.example` | the web app's optional settings                           | yes       |

Variables set in the environment win over `.env` files; deployments set them from the platform's
secret store. The API validates everything at boot and stops with the variable's name on a bad
value: `Environment variable JWT_ACCESS_SECRET is invalid: ...`.

### 6.2 API variables

Required: `NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET`; in production also `TRUST_PROXY`,
`AUDIT_SECRETS_KEY` and `AUDIT_INTEGRITY_KEY`.
Everything else has a safe default. The full table with every rule: [environment.md](environment.md).

| Group               | Variables (default)                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime             | `NODE_ENV` (none), `HOST` (127.0.0.1; every interface in production), `PORT` (3000; 3200 in `apps/api/.env.example`, the development API)                                                                                                                          |
| Database            | `DATABASE_URL` (none), `DB_SLOW_QUERY_MS` (500), `DB_POOL_MAX` (10), `DB_STATEMENT_TIMEOUT_MS` (30000)                                                                                                                                                             |
| Authentication      | `JWT_ACCESS_SECRET` (none), `JWT_ACCESS_SECRET_PREVIOUS` (unset), `AUTH_COOKIE_SAMESITE` (strict)                                                                                                                                                                  |
| Audit Hub           | `AUDIT_SECRETS_KEY` (required in production; elsewhere derived from `JWT_ACCESS_SECRET`), `AUDIT_SECRETS_KEY_PREVIOUS` (unset), `AUDIT_INTEGRITY_KEY` (required in production; elsewhere derived from `JWT_ACCESS_SECRET`), `AUDIT_INTEGRITY_KEY_PREVIOUS` (unset) |
| HTTP                | `CORS_ORIGINS` (empty), `APP_ORIGIN` (unset; set it in production; required with email), `TRUST_PROXY` (loopback; required in production), `RATE_LIMIT_MAX` (100), `RATE_LIMIT_WINDOW_SEC` (60)                                                                    |
| Logs and identity   | `LOG_LEVEL` (log), `LOG_FORMAT` (json in production, else text), `APP_ENVIRONMENT` (NODE_ENV), `APP_RELEASE` (from the image, else unversioned)                                                                                                                    |
| Error tracking      | `SENTRY_DSN` (unset: off), `SENTRY_SAMPLE_RATE` (1)                                                                                                                                                                                                                |
| Tracing and metrics | `OTEL_EXPORTER_OTLP_ENDPOINT` (unset: off), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SDK_DISABLED` (false), `OTEL_SERVICE_NAME` (api), `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_METRIC_EXPORT_INTERVAL` (60000), `OTEL_RESOURCE_ATTRIBUTES`              |
| Redis               | `REDIS_URL` (unset: off), `REDIS_KEY_PREFIX` (app:), `REDIS_REQUIRED` (false), `REDIS_COMMAND_TIMEOUT_MS` (500), `RATE_LIMIT_STORE` (memory), `CACHE_STORE` (memory)                                                                                               |
| Email               | `MAIL_SMTP_URL` (unset: off), `MAIL_FROM` (required with it), `MAIL_MAX_ATTEMPTS` (8), `MAIL_DAILY_LIMIT_PER_ADDRESS` (10), `SIGN_UP_ENABLED` (false; `true` stops the boot: no public sign-up)                                                                    |

### 6.3 Web variables

Set on the web container (the production image), served to the app as `/app-config.json`; the
Vite dev and preview servers read the same names from their environment:

`API_UPSTREAM` (http://api:3000, the API the web server forwards `/api` to), `APP_ENVIRONMENT`
(production), `APP_RELEASE` (set by the image build), `WEB_SENTRY_DSN` (empty: off),
`WEB_SENTRY_SAMPLE_RATE` (1), `WEB_VITALS_SAMPLE_RATE` (1, share of page loads that report their
Web Vitals; 0: off). Development only: `API_PROXY_TARGET` (http://127.0.0.1:3200).
Anything named `VITE_*` is compiled into the public bundle: never a secret.

### 6.4 Compose variables (root `.env`)

`DB_PORT` (5452), `MAILPIT_SMTP_PORT` (1045), `MAILPIT_UI_PORT` (8045), `JWT_ACCESS_SECRET`,
`AUDIT_SECRETS_KEY` and `AUDIT_INTEGRITY_KEY` (the stack's API), `WEB_PORT` (8180), `REDIS_PASSWORD`
(required by the `redis` profile only), `REDIS_PORT` (6389), `OTLP_HTTP_PORT` (4328),
`GRAFANA_PORT` (3201), `PROMETHEUS_PORT` (9190), `APP_RELEASE` (the stack images' release, default
`local`), and the stack's
optional integrations: `STACK_REDIS_URL`, `STACK_RATE_LIMIT_STORE`, `STACK_CACHE_STORE`,
`STACK_OTEL_EXPORTER_OTLP_ENDPOINT`, `STACK_SENTRY_DSN`, `STACK_WEB_SENTRY_DSN`.

### 6.5 Per environment

| Setting               | development                  | CI                                | staging               | production            |
| --------------------- | ---------------------------- | --------------------------------- | --------------------- | --------------------- |
| `NODE_ENV`            | `development`                | `test`                            | `production`          | `production`          |
| `APP_ENVIRONMENT`     | default                      | default                           | `staging`             | `production`          |
| `TRUST_PROXY`         | default                      | default                           | the real hop count    | the real hop count    |
| Secrets               | `apps/api/.env`, root `.env` | generated per run                 | platform secret store | platform secret store |
| Optional integrations | off, or local services       | off (Redis service for its specs) | as decided            | as decided            |

## 7. Command reference

Every command Audit Hub ships.

### 7.1 Root scripts (`pnpm <script>`)

| Command                                                                    | What it does                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                             | installs the workspace; runs `prepare` (installs the Git hooks) and the API's `postinstall` (`prisma generate`)                                                                                               |
| `pnpm dev`                                                                 | `pnpm services:up`, then the API (`nest start --watch`) and the web app (Vite) in parallel; their URLs in a box under the logs                                                                                |
| `pnpm dev:totp`                                                            | the current code of the development accounts' second factor (the seed's public key), to sign in without an authenticator app                                                                                  |
| `pnpm dev:demo`                                                            | demo data for the admin pages: three applications, three weeks of their activity and a few attacks, through the real API (`pnpm dev` running; [2.6](#26-run-it))                                              |
| `pnpm build`                                                               | builds every app (`apps/*/dist`)                                                                                                                                                                              |
| `pnpm lint`                                                                | ESLint on the whole repository, zero warnings allowed                                                                                                                                                         |
| `pnpm lint:fix`                                                            | the same, applying automatic fixes                                                                                                                                                                            |
| `pnpm format`                                                              | Prettier rewrites every file                                                                                                                                                                                  |
| `pnpm format:check`                                                        | Prettier reports unformatted files                                                                                                                                                                            |
| `pnpm typecheck`                                                           | TypeScript in every app, the contract types check and the repository scripts                                                                                                                                  |
| `pnpm test`                                                                | unit and component tests of every app                                                                                                                                                                         |
| `pnpm test:coverage`                                                       | the same with the coverage thresholds                                                                                                                                                                         |
| `pnpm test:integration`                                                    | the API against PostgreSQL (and Redis and Mailpit when configured)                                                                                                                                            |
| `pnpm test:e2e`                                                            | Playwright on the built app                                                                                                                                                                                   |
| `pnpm test:scripts`                                                        | the tests of the repository scripts (`scripts/*.test.mjs`: Semgrep file selection, Doberman's engine)                                                                                                         |
| `pnpm security`                                                            | `pnpm audit --audit-level=high`, then `pnpm deps:check`, then `pnpm secrets:scan`                                                                                                                             |
| `pnpm deps:check`                                                          | dependency policy: registry sources with integrity, licenses, and the supply-chain settings of `pnpm-workspace.yaml`                                                                                          |
| `pnpm secrets:scan`                                                        | secretlint over every file git tracks or would add                                                                                                                                                            |
| `pnpm sast`                                                                | Semgrep with the pinned image (Docker)                                                                                                                                                                        |
| `pnpm lint:workflows`                                                      | actionlint, zizmor and shellcheck with the pinned images (Docker)                                                                                                                                             |
| `pnpm observability:check`                                                 | the dashboards and alert rules of `observability/` (data sources, runbooks, metric names), then promtool and the rules' unit tests (Docker)                                                                   |
| `pnpm iac:check`                                                           | the checks of `infra/terraform`: fmt, validate, tests, TFLint, Trivy, cloud-init, database roles (Docker)                                                                                                     |
| `pnpm iac:database`                                                        | the database roles of a DigitalOcean environment made with Terraform (`deploy-vps.md`)                                                                                                                        |
| `pnpm sbom:generate`                                                       | CycloneDX SBOM of the production dependencies in `dist/sbom/sbom.cdx.json`                                                                                                                                    |
| `pnpm perf:check`                                                          | gzip size of the built web assets against `apps/web/performance-budget.json` (after `pnpm build`)                                                                                                             |
| `pnpm smoke --url <public URL> --api <API URL> [--release <sha>]`          | read-only smoke test of a running deployment ([10.3](#103-smoke-test))                                                                                                                                        |
| `pnpm contract`                                                            | regenerates the contract's JSON Schemas, exports `openapi/openapi.json` and regenerates the web client types                                                                                                  |
| `pnpm connector <add\|status\|diff\|update\|migration> --target <project>` | installs the Audit Hub connector in a project created from project-template-web, and keeps it up to date ([11.9](#119-audit-hub-connecting-a-project))                                                        |
| `pnpm examples <generate\|save> --kind web\|app [--force]`                 | the connected example projects in `.examples/web` and `.examples/app`: generated from the pinned templates and their patches, or their changes saved to `examples/<kind>/template-patch/` and `overlay.patch` |
| `pnpm services:up`                                                         | `docker compose up --detach --wait db mailpit`: the database and the mail catcher                                                                                                                             |
| `pnpm db:up`                                                               | `docker compose up --detach --wait db`                                                                                                                                                                        |
| `pnpm db:down`                                                             | `docker compose down`: removes the database and Mailpit containers, keeps the database's data; optional services stop with their profile                                                                      |
| `pnpm db:migrate [--name <name>]`                                          | creates a migration from schema changes, applies pending ones, regenerates the client (development)                                                                                                           |
| `pnpm db:seed`                                                             | development accounts (local databases only; `--allow-remote-database` for a disposable remote one)                                                                                                            |
| `pnpm verify`                                                              | `format:check` → `lint` → `typecheck` → `test:coverage` → `security` → `build` → `perf:check`                                                                                                                 |

### 7.2 API scripts (`pnpm --filter api <script>`)

| Script             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`              | `prisma generate`, then `nest start --watch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `build`            | `prisma generate`, then `nest build` into `apps/api/dist`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `start`            | `node dist/main.js` (after `build`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `typecheck`        | `prisma generate`, then `tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test`             | Vitest unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `test:watch`       | Vitest in watch mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `test:coverage`    | unit tests with the coverage thresholds of `vitest.config.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `test:integration` | the integration suite (`vitest.config.int.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `openapi:export`   | builds and writes `openapi/openapi.json` (half of `pnpm contract`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `db:migrate`       | `prisma migrate dev` + `prisma generate` (`scripts/migrate.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `db:deploy`        | `prisma migrate deploy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `db:seed`          | builds and runs the seed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `user:create`      | creates one account in the database of `DATABASE_URL`, any environment, the password from stdin: `printf '%s' "$PASSWORD" \| pnpm --filter api user:create --email <email> --name <name> --role admin` (`--role` is required: `admin`, or `auditor` or `viewer`, who sign in once an administrator assigns them an application; [deploy-vps.md](deploy-vps.md#9-create-the-first-administrator) on a server)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `user:reset-mfa`   | removes the second factor of one account and ends its sessions, when it lost both its phone and its recovery codes: `pnpm --filter api user:reset-mfa --email <email> --reason "<why>"`; the next sign-in sets a new one up. Recorded in Audit Hub's own log ([security.md](security.md#second-factor-and-recent-authentication))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dev:totp`         | the current code of the seed's second factor (`pnpm dev:totp` at the root), or of the base32 key given as its argument                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `mail`             | the email outbox's operator commands ([11.5](#115-email)): `mail test --to <address>` (queue a test message, wait for its delivery), `mail status [--to <address>]`, `mail retry --id <id> \| --failed [--kind <kind>]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `audit`            | Audit Hub's integrity commands, on the database of `DATABASE_URL` (no `--` before the options): `audit status` (streams, seals, last verifications), `audit verify [--app <slug>] [--since <date>]` (exit code 1 on a failure, named by id), `audit seal`, `audit checkpoint` (prints the digest to keep outside Audit Hub), `audit retention` (the retention sweep now), `audit geoip [--ip <address>]` (the geolocation files loaded, and a lookup), `audit export --app <slug> --from <date> --to <date> [--out <file>]`, `audit verify-export --file <file>` (offline), `audit secrets:reencrypt` (after rotating `AUDIT_SECRETS_KEY`), `audit app:delete --app <slug> --confirm <slug>` (the end of a suspended application's service, [11.10](#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application)) |
| `e2e:server`       | prepares `<db>_e2e` and runs the built API for Playwright (started by `pnpm test:e2e`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 7.3 Web scripts (`pnpm --filter web <script>`)

| Script          | What it does                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `dev`           | Vite dev server on http://localhost:5273, `/api` forwarded to the API                   |
| `build`         | `tsc -b`, then `vite build` into `apps/web/dist`                                        |
| `preview`       | serves the build on http://localhost:4273, `/api` forwarded                             |
| `typecheck`     | checks `schema.d.ts` against the contract, then `tsc -b`                                |
| `test`          | Vitest component and unit tests                                                         |
| `test:watch`    | watch mode                                                                              |
| `test:coverage` | with the coverage thresholds of `vite.config.ts`                                        |
| `api:types`     | regenerates `src/api/schema.d.ts` from `openapi/openapi.json` (half of `pnpm contract`) |

### 7.4 Repository scripts run directly

| Command                                                                                                         | What it does                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node scripts/check-branch-name.mjs [branch]`                                                                   | checks a branch name (default: the current one)                                                                                                        |
| `node scripts/tool-image.mjs <name>`                                                                            | prints the pinned image of a tool: `actionlint`, `zizmor`, `semgrep`, `gitleaks`, `trivy`, `terraform`, `tflint`, `ubuntu`, `postgres`, `redis`, `zap` |
| `node scripts/smoke-test.mjs ...`                                                                               | the smoke test (`pnpm smoke`)                                                                                                                          |
| `node apps/web/scripts/api-types.mjs [--check]`                                                                 | regenerates, or checks, the web client types                                                                                                           |
| `scripts/git/pre-push.mjs`, `scripts/forbid-env-files.mjs`                                                      | used by the Git hooks                                                                                                                                  |
| `node scripts/check-migrations.mjs [<migration.sql>...]`                                                        | contract steps without a reason in the migrations ([database.md](database.md#expand-and-contract)); `pnpm test:scripts` and the pre-commit hook run it |
| `scripts/check-dependencies.mjs`, `scan-secrets.mjs`, `sast.mjs`, `lint-workflows.mjs`, `check-bundle-size.mjs` | behind the root scripts of the same purpose                                                                                                            |
| `scripts/check-iac.mjs`, `scripts/iac-database.mjs`                                                             | behind `pnpm iac:check` and `pnpm iac:database`                                                                                                        |

### 7.5 Docker Compose

| Command                                                                             | What it starts                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:up`                                                                        | `db`: PostgreSQL 18, `127.0.0.1:${DB_PORT:-5452}`                                                                                                                                 |
| `pnpm services:up`                                                                  | `db`, and `mailpit`: the mail catcher, SMTP on `127.0.0.1:${MAILPIT_SMTP_PORT:-1045}`, web UI on http://localhost:8045 (`MAILPIT_UI_PORT`), messages in memory                    |
| `docker compose --profile redis up -d`                                              | `redis`: Redis 8 with a password, `127.0.0.1:${REDIS_PORT:-6389}`, data in the volume `redis_data`                                                                                |
| `docker compose --profile observability up -d`                                      | `otel-lgtm`: collector, Prometheus, Tempo, Loki and Grafana with the dashboards and rules of `observability/`; OTLP on 4328, Grafana on http://localhost:3201, Prometheus on 9190 |
| `docker compose --profile stack up --build`                                         | `migrate` (runs once), `api`, `web`: the production images at http://localhost:8180                                                                                               |
| `docker compose --profile stack --profile redis --profile observability up --build` | the stack with every optional service (set the `STACK_*` variables, [6.4](#64-compose-variables-root-env))                                                                        |
| `docker compose ps`                                                                 | what runs, with health                                                                                                                                                            |
| `docker compose logs -f <service>`                                                  | follows a service's log (`api`, `web`, `db`, `mailpit`, `redis`, `migrate`)                                                                                                       |
| `docker compose --profile <profile> down`                                           | stops and removes those containers; volumes stay                                                                                                                                  |
| `docker compose down -v`                                                            | **also deletes the volumes**: the development database and Redis data are gone                                                                                                    |
| `docker compose exec db psql -U app -d app`                                         | SQL shell                                                                                                                                                                         |
| `docker compose exec redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli'`       | Redis shell (the password stays out of the command line)                                                                                                                          |

### 7.6 Images without Compose

```
docker build -f apps/api/Dockerfile -t api --build-arg APP_RELEASE=$(git rev-parse HEAD) .
docker build -f apps/api/Dockerfile --target migrate -t api-migrate .
docker build -f apps/web/Dockerfile -t web --build-arg APP_RELEASE=$(git rev-parse HEAD) .
```

The build context is the repository root (an allowlist in `.dockerignore`). The migration image
runs `prisma migrate deploy` by default, after refusing a database whose applied migrations were
edited since (`apps/api/scripts/migrate-deploy.mjs`); the same image answers the other migration
commands
([7.7](#77-operations-commands)).

### 7.7 Operations commands

| Command                                                                                                                                                   | Use                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl http://<api>:3000/api/health/ready`                                                                                                                 | readiness of one instance, from inside the platform                                                                                                                                                                                                                   |
| `docker compose ... run --rm -T api node dist/infrastructure/mail/mail.cli.js status` (`test --to <address>`, `retry --failed`)                           | the email outbox: what waits, what failed and why; a delivery check; failed messages sent again ([11.5](#115-email))                                                                                                                                                  |
| `docker compose ... run --rm -T api node dist/integrity/audit.cli.js status` (`verify`, `checkpoint`, `retention`, `export …`)                            | Audit Hub's integrity: the state of the seals, a verification, a checkpoint to keep elsewhere, the retention sweep, an export (the `audit` script of [7.2](#72-api-scripts-pnpm---filter-api-script); runbooks 20–23 of [incident-response.md](incident-response.md)) |
| `pnpm smoke --url <public URL> --api <API URL> --release <sha>`                                                                                           | after a deployment, a restore, an incident                                                                                                                                                                                                                            |
| `docker run --rm -e DATABASE_URL=<url> <api-migrate image>`                                                                                               | refuses a database whose applied migrations were edited, then applies the pending ones                                                                                                                                                                                |
| `docker run --rm -e DATABASE_URL=<url> <api-migrate image> node node_modules/prisma/build/index.js migrate status`                                        | which migrations an environment has                                                                                                                                                                                                                                   |
| `... migrate resolve --rolled-back <migration>` / `--applied <migration>`                                                                                 | records the outcome of a failed migration ([database.md](database.md#when-a-migration-fails))                                                                                                                                                                         |
| `... migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`                                                                  | compares an environment's schema with the image's, after a restore ([disaster-recovery.md](disaster-recovery.md#restore-procedure))                                                                                                                                   |
| `pg_dump`, `pg_restore`, `createdb`                                                                                                                       | backups and restores ([disaster-recovery.md](disaster-recovery.md#rehearsal-on-a-development-machine))                                                                                                                                                                |
| `BEGIN; SELECT id FROM users WHERE id = '<id>' FOR UPDATE; UPDATE sessions SET revoked_at = now() WHERE user_id = '<id>' AND revoked_at IS NULL; COMMIT;` | ends every session of one user (security incident); the user's lock keeps a refresh in flight from outliving it                                                                                                                                                       |

## 8. CI/CD

### 8.1 Workflows

| Workflow                    | Runs                                                                                                                            | Does                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` (**CI**)           | every pull request, every push to `main`, by hand                                                                               | dependency review (opt-in), every gate, the images; one check: **CI passed**                                                                                                                                                                                                                                                                                |
| `conventions.yml`           | every pull request, again when its title is edited                                                                              | branch name and title (Conventional Commits); its check **Conventions** is required                                                                                                                                                                                                                                                                         |
| `quality-gates.yml`         | called by CI and Deploy                                                                                                         | format, lint, types, workflows, Semgrep, infrastructure as code, tests with coverage, integration, security, build, E2E, images                                                                                                                                                                                                                             |
| `docker-images.yml`         | called by the gates (build and scan) and by a deployment (push)                                                                 | builds `api`, `api-migrate`, `web`, scans them with Trivy; pushes with SBOM and provenance when asked                                                                                                                                                                                                                                                       |
| `codeql.yml`                | pull requests, `main`, weekly, when `ENABLE_CODEQL=true`                                                                        | cross-file security analysis (ADVISORY)                                                                                                                                                                                                                                                                                                                     |
| `dast.yml`                  | Mondays 04:41 UTC, by hand                                                                                                      | production images on the runner, smoke test, ZAP baseline and API scan; or the passive scan of staging (ADVISORY)                                                                                                                                                                                                                                           |
| `examples.yml`              | pull requests and pushes to `main` that touch the connector, the contract, ingestion or `examples/`; Mondays 05:23 UTC; by hand | generates the connected examples from the pinned templates; for the web example, its `pnpm verify`, its integration suite, `pnpm connector status --check` and the cross suite with Audit Hub (`pnpm test:e2e:examples`); for the app example, its `pnpm verify` and its Maestro flows on an Android emulator ([11.9](#119-audit-hub-connecting-a-project)) |
| `release.yml`               | pushes to `main`                                                                                                                | the release pull request and CI on it; once merged, the tag, the GitHub release and the SBOM                                                                                                                                                                                                                                                                |
| `main-guard.yml`            | every push to `main`                                                                                                            | checks that each pushed commit is a merged pull request; otherwise fails and opens an issue                                                                                                                                                                                                                                                                 |
| `dependabot-auto-merge.yml` | an approval of a Dependabot pull request                                                                                        | merges a patch or minor update once **CI passed** (checks the approval and CI itself)                                                                                                                                                                                                                                                                       |
| `deploy.yml` (**Deploy**)   | by hand, from `main`                                                                                                            | resolves the ref to a commit on `main`, re-runs the gates, releases (the VPS target, or a job of your own)                                                                                                                                                                                                                                                  |

Dependabot opens grouped update pull requests every week (npm, GitHub Actions, base images, tool
images, Terraform providers), with the same seven-day delay as the install policy. You approve each
one; a patch or minor update then merges itself once CI passes, and majors or workflow updates you
merge by hand ([ci-cd.md](ci-cd.md#dependency-updates)).

### 8.2 Running and reading them

```
gh run list                              # recent runs
gh run watch                             # follow the current one
gh run view <run id> --log-failed        # the failing steps' logs
gh run rerun <run id> --failed           # re-run only the failed jobs
gh workflow run ci.yml --ref <branch>    # CI by hand
gh workflow run dast.yml -f target=local-stack
gh workflow run dast.yml -f target=staging
```

Reports are attached to the run as artifacts (coverage, Playwright report, ZAP reports). What is
BLOCKING and what is ADVISORY, and why: [ci-cd.md](ci-cd.md#quality-gates-blocking-and-advisory).
Every failure message with its fix: [troubleshooting.md](troubleshooting.md).

The same checks locally: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm sast`,
`pnpm lint:workflows`, `pnpm observability:check`, `pnpm iac:check`.

## 9. Releases

1. Merge pull requests with Conventional Commit titles. `fix:`/`perf:` make a patch, `feat:` a
   minor, `!` or `BREAKING CHANGE:` a major (before 1.0.0: a minor).
2. **Release** keeps one release pull request open with the next version and the `CHANGELOG.md`
   entry. Review it like any pull request.
3. Merge it: the workflow tags `vX.Y.Z` (immutable), publishes the GitHub release with the notes and
   attaches `sbom.cdx.json`.
4. Deploy the tag ([10](#10-deploying-and-rolling-back)): releasing and deploying are separate steps.

The version continues from the one in `.release-please-manifest.json` (`0.1.0` now): before
1.0.0, a `fix` makes the next patch (0.1.1) and a `feat` the next minor (0.2.0); the footer
`Release-As: <version>` on a merged commit chooses another. The release workflow
starts CI and **Conventions** on the release pull request itself; with `RELEASE_PLEASE_TOKEN` set,
every pull request workflow runs on it instead ([ci-cd.md](ci-cd.md#release-pull-requests)).

## 10. Deploying and rolling back

### 10.1 Implement the release job once (REQUIERE CONFIGURACIÓN)

**Ready-made target:** one Linux server per environment with Docker and a managed PostgreSQL. Set
the repository variable `DEPLOY_TARGET=vps` and follow [deploy-vps.md](deploy-vps.md) (step by step:
[step-by-step.md](step-by-step.md#phase-7-production-servers)); nothing below needs writing. On
DigitalOcean, Terraform (`infra/terraform/digitalocean`) can create the servers and databases
instead of the manual steps, with the same result
([deploy-vps.md](deploy-vps.md#provision-with-terraform-digitalocean)). For any other platform:

`.github/workflows/deploy.yml` re-runs every gate on the exact commit, then hands over to the
protected environment, where the release job fails on purpose until it is written for your
platform. Implement it in this order (the comments in the file repeat it):

1. Push the images once per commit (`docker-images.yml` with `push: true`, after the registry login
   step marked in that file), scan the digests the push reports and record them; reuse the digests
   staging recorded, so production runs what staging verified, and scan them again before
   production.
2. Deploy `<image>@<digest>` only, with the digests of the build or of that record: never looked up
   from the tag `<image>:<sha>`, which any workflow with `packages: write` can push.
3. Record the digests running before the change: the rollback target.
4. Run the `api-migrate` image against the environment's database; stop on failure.
5. Roll out `api`, then `web`, waiting for readiness.
6. `node scripts/smoke-test.mjs --url <public URL> --api <API URL> --release <sha>`.
7. On failure, redeploy the recorded digests.

The full sequence, the compatibility rules between versions and the rollback table:
[ci-cd.md](ci-cd.md#deployment).

### 10.2 Deploy

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=v1.4.0
gh run watch
```

Or GitHub → Actions → **Deploy** → Run workflow (from `main`), with the environment and the ref (a
release tag, a branch or a commit SHA on `main`). Staging first; verify; then the same ref to
`production` (the environment asks its reviewers to approve).

### 10.3 Smoke test

```
pnpm smoke --url https://<public host> --api http://<api inside the platform>:3000 --release <sha>
```

| Check                      | Passes when                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| web server health          | `/healthz` answers 200                                                          |
| app shell                  | `/` is the app, with the CSP and `X-Content-Type-Options` headers               |
| runtime configuration      | `/app-config.json` answers, with the expected release when `--release` is given |
| API through the web server | an unknown `/api/...` route answers the API's JSON 404 with a request id        |
| probes not public          | `/api/health/ready` answers 404 through the public URL                          |
| API liveness and readiness | 200 on the API itself (`degraded` is reported, not a failure)                   |

It signs nobody in and writes nothing; any failure exits with status 1. Either URL can be left out
to check one side only.

### 10.4 Roll back

- **The application failed** (errors, latency, smoke test): redeploy the digests recorded before the
  deployment. Never rebuild an old commit for a rollback, and never reverse a migration.
- **The migration failed:** the running version keeps serving; repair the database and resolve
  the migration ([incident-response.md](incident-response.md#10-failed-database-migration)).
- **Planned rollback:** run Deploy with the previous tag (it re-runs the gates on that commit).

[ci-cd.md](ci-cd.md#rollback) has the full table.

## 11. Optional infrastructure

Off by default; turning each on is configuration. Nothing here is needed to develop, test or deploy.
Email is the one on by default locally, against Mailpit ([11.5](#115-email)).

### 11.1 Redis

Shared rate limits across instances, a shared cache, locks and idempotency claims.

1. Root `.env`: `REDIS_PASSWORD=<output of openssl rand -hex 24>`.
2. `docker compose --profile redis up -d`
3. `apps/api/.env`: `REDIS_URL=redis://:<that password>@127.0.0.1:6389`, and the features to move:
   `RATE_LIMIT_STORE=redis`, `CACHE_STORE=redis`.
4. `pnpm dev`: the log says `Redis connected (redis://127.0.0.1:6389)`; readiness shows
   `"redis": "ok"`. Stop the container (`docker compose stop redis`) to see the degraded mode, start
   it (`docker compose --profile redis start redis`) to see the recovery.
5. Production (REQUIERE CONFIGURACIÓN): a private Redis with TLS and an ACL user, `rediss://` from
   the secret store, `REDIS_KEY_PREFIX` per environment; `REDIS_REQUIRED=true` only if your instance
   cannot work without it ([security.md](security.md#redis), [architecture.md](architecture.md#redis)).

### 11.2 Error tracking (Sentry)

1. Create two Sentry projects: Node.js (API) and browser JavaScript (web).
2. API: `SENTRY_DSN` (secret store; locally in `apps/api/.env`). Web: `WEB_SENTRY_DSN` on the web
   container (locally in the environment of `pnpm dev`). `APP_ENVIRONMENT` on both.
3. Check: the boot line says `error tracking on`; `/app-config.json` shows the DSN; the CSP allows
   Sentry's ingest host.
4. Alert rules in Sentry ([alerting.md](alerting.md)). What is never sent: [security.md](security.md#error-tracking-data).

### 11.3 Tracing and metrics (OpenTelemetry)

1. Locally: `docker compose --profile observability up -d`, then
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4328` in `apps/api/.env`, restart `pnpm dev`.
2. Send a few requests; Grafana at http://localhost:3201: Dashboards → Application ("API service",
   "API SLOs"), Alerting → Alert rules, Explore → Tempo (traces), Prometheus (metrics).
3. Deployed (REQUIERE CONFIGURACIÓN): the collector's or provider's endpoint, its credentials in
   `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and
   `OTEL_TRACES_SAMPLER_ARG=0.1`. Kill switch: `OTEL_SDK_DISABLED=true`.
4. Dashboards and alert rules: the files of `observability/`, imported into your Grafana and loaded
   into your Prometheus or Grafana Cloud
   ([observability.md](observability.md#use-them-with-your-backend)); routing per
   [alerting.md](alerting.md).

### 11.4 The production-like stack with everything

Root `.env`:

```
JWT_ACCESS_SECRET=<openssl rand -hex 32>
AUDIT_SECRETS_KEY=<openssl rand -hex 32>
AUDIT_INTEGRITY_KEY=<openssl rand -hex 32>
REDIS_PASSWORD=<openssl rand -hex 24>
STACK_REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379
STACK_RATE_LIMIT_STORE=redis
STACK_CACHE_STORE=redis
STACK_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318
```

```
docker compose --profile stack --profile redis --profile observability up --build
```

Web at http://localhost:8180, Grafana at http://localhost:3201. Stop with
`docker compose --profile stack --profile redis --profile observability down`.

### 11.5 Email

The API sends email through an outbox: a feature writes the message in the same transaction as the
change it reports, and a worker inside every API instance delivers it over SMTP, with retries
([architecture.md](architecture.md#email)). Without `MAIL_SMTP_URL` email is off: nothing is
queued, readiness says `checks.mail: "disabled"`, and the rest of the API works.

**Locally**, `pnpm dev` starts Mailpit, a mail catcher: the API sends to it
(`MAIL_SMTP_URL=smtp://localhost:1045`, in `apps/api/.env.example`), nothing leaves the machine,
and every message is at http://localhost:8045. The box `pnpm dev` prints shows it on its `Mail`
row, with what readiness says (`ok`, `degraded`). Check the whole path:

```
pnpm --filter api mail test --to you@example.test   # queued, then sent by the running API
```

and the message appears in Mailpit. Messages live in Mailpit's memory: `pnpm db:down` clears them.

**In production**, any provider's SMTP server works (Amazon SES, Postmark, Resend, Brevo...). In
the API's environment ([deploy-vps.md](deploy-vps.md#6-the-files-on-the-server) on a server):

```
MAIL_SMTP_URL=smtps://<user>:<password, percent-encoded>@<provider host>:465
MAIL_FROM="Audit Hub <no-reply@<your domain>>"
APP_ORIGIN=https://<your domain>
```

or `smtp://...:587`: production requires STARTTLS on it and refuses a server without TLS (Mailpit
among them), except one on the machine itself (`localhost`, `127.0.0.1`, `[::1]`).
`APP_ORIGIN` is where links in messages point: never a request's Host. Before the
first message, authenticate the sending domain at the provider (SPF, DKIM, DMARC): without them
messages land in spam or are refused. Then, from the API image:

```
docker compose ... run --rm -T api node dist/infrastructure/mail/mail.cli.js test --to <you>
```

**Operating it:** `mail status` shows what waits, what failed and why (never an address: messages
are named by id; `--to <address>` finds one address's messages); `mail retry --failed` sends failed
messages again once the cause is fixed, each with a new validity (an outage longer than it does not
drop them; links still start their own validity when they are sent). Alerts `ApiMailBacklog` and `ApiMailDeliveryFailed`, and
the runbook: [incident-response.md](incident-response.md#16-email-not-delivered). To rotate the SMTP
credentials, create the new ones at the provider, update `MAIL_SMTP_URL`, redeploy, then revoke the
old ones; messages waiting meanwhile go out with their next attempt.

**Password recovery and change.** With email on, the sign-in page offers "Forgot your password?":
the person enters their address, receives a link valid for 30 minutes and once, and chooses a new
password (15 characters or more; the rules: [security.md](security.md#passwords)). Signed in, the
Account page (top menu) changes it with the current one. Either way every other session of the
account is signed out at once, and the owner gets a "your password was changed" message. Try it
locally: `pnpm dev`, sign out, "Forgot your password?" with `member@example.com`, and open the
link from Mailpit (http://localhost:8045). Without email the link is not shown and the reset
routes answer 503; changing it while signed in still works.

**No public sign-up.** The template's "Create an account" never opens in Audit Hub: its accounts
come from an administrator's invitation (below) or `user:create`, and `SIGN_UP_ENABLED=true` stops
the boot. The sign-in page offers no link, `/sign-up` says how accounts are made, and
`POST /api/auth/sign-ups` answers 403. Why: [security.md](security.md#sign-up).

**Change of email.** With email on, the Account page also offers "Change your email": a new
address and the current password. A link goes to the new address, and nothing changes until it is
opened; then every session is signed out (sign in with the new address), and the previous address
gets a notice with a link that undoes the change for 7 days, asking for a new password. Try it
locally with any two addresses and Mailpit. The design: [security.md](security.md#change-of-email).

**Invitations.** With email on, administrators see "Invitations" in the top menu: an address, a
role (admin, auditor or viewer) and, for an auditor or a viewer, the applications they will see
(at least one: without one they could not sign in) send a link valid for 7 days; the person opens
it, chooses their name and password, sets up their second factor, and is signed in with that role
and those applications. Members are not invited: a member cannot sign in. Pending invitations can
be sent again or revoked; one that no longer gives access (its applications were all retired, or
it invites a member from before) cannot be accepted: revoke it and invite again. Try it locally:
sign in as `admin@example.com`, invite any address, and open the link from Mailpit. The design:
[security.md](security.md#invitations).

### 11.6 Audit Hub: alert notifications and IP geolocation

Detection rules run in every environment ([security.md](security.md#detection-rules)): alerts
appear in the admin pages and go to the application's webhook. Three integrations add to them,
all off until configured:

- **Email:** with email on (11.5), each new alert of high or critical severity is sent to the
  administrators and to the auditors assigned to its application (ids and the rule only).
- **Slack or Teams:** `AUDIT_SLACK_WEBHOOK_URL` (an incoming webhook of a Slack channel) or
  `AUDIT_TEAMS_WEBHOOK_URL` (a Teams workflow started by "when a Teams webhook request is
  received", which posts the Adaptive Card it gets): new alerts from medium severity, with a link
  to the alert when `APP_ORIGIN` is set. Both are secrets; https only.
- **IP geolocation:** `GEOIP_CITY_DB_PATH` and `GEOIP_ASN_DB_PATH` name `.mmdb` files (DB-IP
  Lite City and ASN, monthly, CC BY 4.0; [deploy-vps.md](deploy-vps.md#ip-geolocation) says how to
  download them), and `GEOIP_HOSTING_ASNS_PATH` an optional list of hosting and VPN ASNs. Without
  them the country, travel and hosting rules do not run. Check what is loaded, and what it says of
  an address: `pnpm --filter api audit geoip --ip 8.8.8.8`.

An application's webhooks are tested from its page in the admin pages, or with
`POST /api/connected-apps/:id/webhook-test`; every delivery, with its last HTTP status and the
reason it failed, is in `GET /api/connected-apps/:id/webhook-deliveries`. Locally, webhooks to
`localhost` need `AUDIT_WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` (an address that is not on the
public internet is refused otherwise).

### 11.7 Audit Hub: two-step verification, access and exports

Every account signs in with its password and a code from an authenticator app (Google
Authenticator, Microsoft Authenticator, 1Password, Bitwarden...). The first sign-in, and the end of
a sign-up or an invitation, set it up: scan the QR code (or type the key shown under "Can't scan
it?"), enter the code, and keep the 10 recovery codes shown once, each good for one sign-in
without the phone ([security.md](security.md#second-factor-and-recent-authentication)).

- **Lost phone:** sign in with a recovery code ("Use a recovery code instead"), then make new ones.
  Without codes either, an administrator resets the factor from the admin pages, or an operator
  on the server: `pnpm --filter api user:reset-mfa --email <email> --reason "<why>"` (in
  production `docker compose ... run --rm -T api node dist/users/reset-mfa.cli.js ...`, as
  [deploy-vps.md](deploy-vps.md#9-create-the-first-administrator) runs `user:create`).
- **Sensitive actions** (exports, application keys, response actions, legal holds, retention,
  roles and assignments, disabling and removing accounts, erasure, the end of an application's
  service, MFA resets) ask for the password and a fresh code again when
  the last step-up is older than 5 minutes.
- **Who may sign in:** administrators, and auditors and viewers who see at least one application
  still in service. Anyone else (a member, an auditor or a viewer without an application) is told
  "Your account does not have administrative access to this panel" once the password is right,
  before any code; a session already open ends at its next refresh (within 15 minutes) when the
  role becomes member or the last application is unassigned or retired
  ([security.md](security.md#who-may-sign-in)).
- **Who sees what:** administrators see every application; auditors and viewers the ones an
  administrator assigns them (`PUT /api/users/:id/apps`, or with their invitation); members none,
  and they cannot sign in. Roles change with `PATCH /api/users/:id/role`; the last administrator
  who may sign in cannot be demoted. An account is disabled, enabled or removed from its page
  ([11.10](#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application)).
- **Exports** (administrators and auditors): CSV or JSON Lines of the explorer's filters, at most
  100,000 rows, without personal data. Each keeps the SHA-256 of its body:
  `GET /api/exports/<Audit-Export-Id>` gives it, to check a copy later
  (`sha256sum file | xxd -r -p | base64`).
- Every read of audit data (searches, views, exports) is recorded in Audit Hub's own log, under the
  `audit-hub` application.

### 11.8 Audit Hub: the admin pages

What each role sees after signing in ([ADR 0014](adr/0014-build-the-admin-pages-lazily-with-own-svg-charts.md)):

| Page                                                                     | Who                    | What it does                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview (`/`)                                                           | viewer, auditor, admin | at a glance: the log's integrity, open alerts, high-risk events in 24 h; quick response actions on an application's user (admin); then every visible application: events in 24 h with their trend, rejections, open alerts, heartbeat, gaps                      |
| Events (`/events`)                                                       | viewer, auditor, admin | the explorer: each event at a glance (date and time, actor, action in words, application, outcome, risk) and its whole detail in a side panel, loaded when opened; filters in the URL (risk among them), newest first, a page at a time; export (auditor, admin) |
| An event (`/events/:id`)                                                 | viewer, auditor, admin | every section (actor, network and location, request, client, audit and integrity with its content hash and seal, resource), the change and the details as highlighted JSON, the same request                                                                     |
| A user (`/apps/:app/actors/:id`)                                         | viewer, auditor, admin | what they did and what was done to them; erasure of their personal data or events (admin, step-up)                                                                                                                                                               |
| A resource (`/apps/:app/resources/...`)                                  | viewer, auditor, admin | its history                                                                                                                                                                                                                                                      |
| Security (`/security`)                                                   | viewer, auditor, admin | failed sign-ins by day, addresses, countries, a day × hour heatmap, open anomalies                                                                                                                                                                               |
| Alerts (`/alerts`)                                                       | viewer, auditor, admin | the rules' alerts, each with who it is about by name, and its whole detail in a side panel, loaded when opened; filters in the URL, a page at a time                                                                                                             |
| An alert (`/alerts/:id`)                                                 | viewer, auditor, admin | why it fired in words, what its events show (how they ended and why, accounts, countries, devices), who it is about and who works on it by name, the events behind it, its history; review it (auditor, admin), ask the application to act (admin)               |
| Response actions, Applications, Retention, Integrity, Users, Invitations | admin                  | approvals, keys and webhooks, the end of a service, retention and legal holds, seals, accounts                                                                                                                                                                   |
| Exports (`/exports`)                                                     | auditor, admin         | the exports made, with the digest to check a copy                                                                                                                                                                                                                |
| Account (`/account`)                                                     | everyone               | password, email, second factor and new recovery codes                                                                                                                                                                                                            |

A sensitive action (an export, a key, a role, an erasure, a legal hold, a response action) asks
for your password and a fresh code again when the last time was more than 5 minutes ago. Values
from the applications' events are always shown as text.

**The overview's figures.** Log integrity is the latest verification that covered your
applications: verified, failed (an administrator opens Integrity), not finished, or not verified
yet. High-risk events are those of the last 24 hours with a risk score of 60 or more (a high
severity's weight: [security.md](security.md#risk-score)); "See them" opens them in the
explorer. Administrators also get **Respond quickly**: an application, a user's id there and a
reason, then "Revoke sessions", "Force a password change" or "Disable the account". It asks for
the step-up, and, where the application requires it (the default), a second administrator
approves it under Response actions.

**An event's detail.** "View details" on a row opens its detail beside the table: who (name, the
email's pseudonym: Audit Hub never keeps addresses, id, role, type), from where (IP address,
place, coordinates, user agent, device, operating system), the request (route, method, status,
duration, request and trace ids), the client, its audit and integrity facts (risk out of 100,
severity, category, the content hash, the seal's hash, signature and key), and the change and
details as highlighted JSON. Escape or Close returns to the row; "Open as a page" gives it its own
address, with the other events of the same request.

What it can say depends on what the application sends ([connection guide](audit/connection-guide.md#recording-events)):

- **Name and phone:** the person's full name when the application gives it (else their email,
  masked); their phone, if their account has one, only as its last four digits (`•••• 1234`).
  Audit Hub never keeps an email address or a phone number.
- **Browser and system:** read from the user agent and, from Chromium browsers (Chrome, Edge,
  Brave, Opera), their client hints: the real brand and version, Windows 11 told from 10, a
  phone's model. Firefox and Safari send no hints: their user agent says less ("Windows 10 or
  11", "macOS 10.15.7 or later": what browsers freeze).
- **Place:** from the IP address, the city and approximate coordinates, once IP geolocation is
  configured ([11.6](#116-audit-hub-alert-notifications-and-ip-geolocation)); never exact. From a
  phone, with the person's consent, the position when a session starts (at sign-in, or opening the
  app while signed in): precise (five decimals, the accuracy
  in metres) when they allowed it in the phone's dialog, approximate (about 1 km) otherwise.
  Kept 30 days.

**An alert's detail.** "View details" on an alert opens it beside the list, the same way:

- **Why it fired**, in words: what the rule saw this time ("12 failed sign-ins of Ann Example
  (user-42) within 15 minutes", "New device: one this account had not used before (Microsoft Edge
  on Linux)", "Impossible travel: 9,050 km from where the account was 2 hours before") and what
  the rule looks for, with its threshold.
- **Who and when:** the person it is about by name, then their id; occurrences, first and last
  seen; who it is assigned to and who resolved it, by name.
- **What the events show:** what the events behind it have in common, counted: how they ended and
  why (their reasons, the errors: "invalid credentials × 9, mfa failed × 3"), the actions, how
  many accounts, the countries and the devices.
- **The events behind it** (on its page, as in the explorer, each with its own detail), its
  **history** by name, and what the rule kept, as highlighted JSON.

Reviewing it and asking the application to act are on its page ("Open as a page"). Alerts keep
ids and counts only: the names are looked up when an alert is read, and each read is recorded in
Audit Hub's own log, as a search of events is.

### 11.9 Audit Hub: connecting a project

A project created from project-template-web sends its audit log through the NestJS connector,
copied into it as source ([ADR 0009](adr/0009-distribute-connectors-as-vendored-source.md)). The
whole procedure, the variables and where each flow is recorded:
[docs/audit/connection-guide.md](audit/connection-guide.md). In short:

1. In Audit Hub, register the application (Applications → Register an application; an
   administrator, with a step-up) and keep the variables it shows once. One application per backend
   and environment: a web app and a mobile app on one API are one application; production and
   staging are two (the guide's [Which applications to register](audit/connection-guide.md#which-applications-to-register)).
   Audit Hub never connects to the project's database: the connector, inside its API, sends it the
   events.
2. From a checkout of Audit Hub at a release tag: `pnpm connector add --target <project>`. In the
   project: `pnpm db:migrate`, the four wiring edits the command prints, and the flows to record
   (the guide's [Integration points](audit/connection-guide.md#integration-points)).
3. Set the `AUDIT_HUB_*` variables in the project's environment and redeploy. Within a minute the
   Overview shows the application's last heartbeat, and the explorer its events. With a mobile
   app, `AUDIT_HUB_PUSH=expo` also pushes "Was it you?" to the user's phones (the guide's
   [Push notifications](audit/connection-guide.md#push-notifications)).
4. Later, `pnpm connector status --target <project>` shows local edits and the version available;
   `pnpm connector update --target <project>` merges a new one, and writes the migration when it
   changes the connector's tables: then `pnpm db:migrate`.

A project created from the templates after their patches were applied already ships the
connector, installed and off: it only sets the variables (step 3). The patches are `examples/web/template-patch/` and
`examples/app/template-patch/`, `git format-patch` series the templates' owner applies
(`git am examples/<kind>/template-patch/*.patch`): besides the connector, they fill the template
gaps the design lists (roles, disabled accounts, a required new password, account deletion, three
test defects of the web template and the app's offline banner under the status bar).

A project connected this way, to try it or change it: `pnpm examples generate --kind web` builds
`.examples/web` (the template at its pinned commit, its patches as commits, the connector brought
to this checkout's version, and `examples/web/overlay.patch` if the example adds anything on top)
with its own database, `example_web`, and its own ports: 3400 for the API, 5373 for the web app.
After changing it there, `pnpm examples save --kind web` writes back both the overlay (the changes
since the base commit) and the patches (the commits before it): to change a patch, rewrite its
commit in the example ([ADR 0010](adr/0010-generate-the-example-projects-in-ci.md)).

The project's mobile app, created from project-template-app, gets the Expo connector:
`pnpm connector add --kind expo --target <app>`. It sends the phone's own events (a session
started, with the approximate location only with its own consent; a session expired; a link
refused) to the project's API, never to Audit Hub; it keeps them per user while offline and never
sends one user's events as another's; and it shows the account's activity and "Was it you?"
([the guide's mobile app](audit/connection-guide.md#the-mobile-app)). Its example:
`pnpm examples generate --kind app` builds `.examples/app` against the template's mock API, with
Maestro flows for offline, sign-out between users and "Was it you?". The web app gets the SPA
connector, `pnpm connector add --kind spa --target <project>/apps/web`: what only the page sees (a
CSP violation, a refused return path, an expired session), from a lazy chunk loaded only when the
API's connector is on, and the account's activity
([the guide's web app](audit/connection-guide.md#the-web-app)); `.examples/web` has both.

### 11.10 Audit Hub: privacy requests, its accounts and the end of an application

What Audit Hub does with each request a person or a client makes about their data; who answers
them, and in how long, is in [docs/privacy/](privacy/README.md) (the ARCO procedure).

- **A user of an application asks to be erased** (cancellation): the application's connector asks
  for it, or an administrator on the user's page (Right to erasure, with a step-up). "Their
  personal data" deletes the addresses, devices, labels and places of their events and keeps the
  events, pseudonymous, until their retention; "Their events too", once the application cancelled
  their data, deletes the events as well: the sealed ones at once, the rest within a day. What a
  legal hold keeps is never deleted.
- **After an erasure the user is blocked** (LFPDPPP art. 24): their page says since when, and
  their page, a search by their id or email, its export and the application's own activity view
  leave out what occurred up to their last erasure; what they did after it (an account that stays)
  shows as usual. Searches by anything else still find the blocked events, pseudonymous (an
  incident's log stays whole), and an event's page says its user is blocked. A legal hold that
  names them lifts the block while it is active.
- **Someone leaves the team** (or asks to be removed from Audit Hub): on their page under Users,
  "Disable their account…" signs them out everywhere at once and refuses their next sign-in;
  "Enable their account" lets them back. "Remove from Audit Hub…" deletes everything of the person
  (address, name, password, second factor, sessions, applications) and keeps only the account's
  id, so Audit Hub's own log still says who did what; the open alerts assigned to them are
  assigned to nobody. Nobody disables or removes their own account or the last administrator.
- **An application's service ends** (the contract with the client finished, the system was shut
  down): suspend it (its page, Settings), then "End of service" → "Delete its audit log…", type its
  slug and confirm. Each click deletes for up to 10 seconds and goes on by itself; "waiting" means
  events not sealed yet (within 2 minutes), "held" a legal hold to release first. Once nothing is
  left the application is retired: its page says so and nothing it sends is accepted. On the
  server, for a large log:
  `pnpm --filter api audit app:delete --app <slug> --confirm <slug>` (in production
  `docker compose ... run --rm -T api node dist/integrity/audit.cli.js app:delete ...`), which
  waits for the seals by itself.

Every one of these is recorded in Audit Hub's own log (`hub.subject.erased`, `hub.user.disabled`,
`hub.user.enabled`, `hub.user.removed`, `hub.app.deleted`) and the integrity verification keeps
passing ([security.md](security.md#audit-log-integrity-retention-and-erasure)).

## 12. Running in production

| Before and while running               | Where                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| The checklist before the first release | [production-readiness.md](production-readiness.md)            |
| Backups, restores, RPO and RTO         | [disaster-recovery.md](disaster-recovery.md)                  |
| SLOs, error budget, the alert catalog  | [alerting.md](alerting.md)                                    |
| What each signal means                 | [observability.md](observability.md)                          |
| What to do when an alert fires         | [incident-response.md](incident-response.md): 14 runbooks     |
| Capacity                               | [load-testing.md](load-testing.md) (OPTIONAL)                 |
| Security settings per instance         | [security.md](security.md#per-project-requiere-configuración) |
| The legal documents                    | [privacy/](privacy/README.md)                                 |

The minimum to have before production traffic (REQUIERE CONFIGURACIÓN): automated backups with one
restore drill done, the deployment job with digests and the smoke test, uptime checks, the
CRITICAL alerts routed to someone, `TRUST_PROXY` for the real topology, TLS at the edge, and the
contacts table of incident-response.md filled in. For Audit Hub also: `AUDIT_SECRETS_KEY` and
`AUDIT_INTEGRITY_KEY` in the secret store, the checkpoint digests kept outside Audit Hub, and the
processor contract signed ([2.8](#28-decisions-for-your-instance-requiere-configuración)).

Rehearse a restore on your machine (it takes a few minutes; Windows: prefix with
`MSYS_NO_PATHCONV=1`):

```
docker compose exec -T db pg_dump -U app -d app --format=custom --no-owner --no-privileges --file=/tmp/app.dump
docker compose exec -T db createdb -U app app_restore_check
docker compose exec -T db pg_restore -U app -d app_restore_check --no-owner --no-privileges --exit-on-error /tmp/app.dump
DATABASE_URL=postgresql://app:app@localhost:5452/app_restore_check pnpm --filter api exec prisma migrate status
docker compose exec -T db dropdb -U app app_restore_check
docker compose exec -T db rm /tmp/app.dump
```

## 13. Maintenance calendar

| When                          | What                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every week                    | Review and approve Dependabot's pull requests: patch and minor updates merge themselves once CI passes; majors and workflow updates you merge by hand ([ci-cd.md](ci-cd.md#dependency-updates)). On the VPS target, one that changes `deploy/vps` (the Caddy image) also needs the files copied to each server before its next deployment ([deploy-vps.md](deploy-vps.md#update-the-server-files)). |
| Every week (automatic)        | DAST runs on Mondays: read the ZAP reports of failed runs.                                                                                                                                                                                                                                                                                                                                          |
| Every release                 | Staging first, smoke test, then production with the same digests.                                                                                                                                                                                                                                                                                                                                   |
| Every month                   | With IP geolocation: the new DB-IP files on each server ([deploy-vps.md](deploy-vps.md#ip-geolocation)).                                                                                                                                                                                                                                                                                            |
| As decided in 2.8             | Copy the last checkpoint digest (the Integrity page, or `audit checkpoint`) to its place outside Audit Hub.                                                                                                                                                                                                                                                                                         |
| Every quarter                 | A restore drill with the [checklist](disaster-recovery.md#checklist); a review of the alerts (noise, gaps) and a test alert through the routing; a look at the error budget policy; what Dependabot never proposes: a Node.js LTS major (each October), pnpm, PostgreSQL and Redis majors ([ci-cd.md](ci-cd.md#keeping-the-stack-current)).                                                         |
| When coverage rises           | Raise the thresholds in the same pull request ([testing.md](testing.md#coverage)).                                                                                                                                                                                                                                                                                                                  |
| When a secret may have leaked | Rotate it at once ([security.md](security.md#secret-rotation)).                                                                                                                                                                                                                                                                                                                                     |
| After every incident          | The postmortem, and updates to the runbook and the alerts it exposed.                                                                                                                                                                                                                                                                                                                               |

## 14. When something fails

Search [troubleshooting.md](troubleshooting.md) for a few words of the message: it lists the
messages the tools actually print, with cause and fix, grouped by install, database, API, optional
infrastructure, quality gates, deployment, Git hooks and end-to-end tests. The ones new users meet
first:

| Message                                                            | Fix                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                                      | Node.js 24.15+ ([1.1](#11-install-the-tools))                                                                                           |
| `port is already allocated` on `pnpm db:up`                        | `DB_PORT=5443` in the root `.env` and in `DATABASE_URL`                                                                                 |
| `Environment variable JWT_ACCESS_SECRET is invalid`                | `openssl rand -hex 32` into `apps/api/.env`                                                                                             |
| `Cannot reach PostgreSQL at localhost:5452` (integration tests)    | `pnpm db:up`                                                                                                                            |
| No email in Mailpit (http://localhost:8045)                        | the `Mail` row of the `pnpm dev` box: `off` (set `MAIL_SMTP_URL`), or a warning about its port ([11.5](#115-email))                     |
| `Executable doesn't exist ... playwright install`                  | `pnpm exec playwright install chromium`                                                                                                 |
| `pre-push: Direct pushes to "main" are not allowed`                | push a branch and open a pull request                                                                                                   |
| `Could not start Docker` from `pnpm sast` or `pnpm lint:workflows` | start Docker                                                                                                                            |
| `pnpm sast` takes many minutes                                     | the first run pulls the image; otherwise check Docker's CPU and memory and large untracked files (it takes a few minutes; CI about two) |

## 15. Appendix: ports, accounts, files

### 15.1 Ports and URLs

| Port | What                                       | Started by                                     |
| ---- | ------------------------------------------ | ---------------------------------------------- |
| 3200 | API (development)                          | `pnpm dev`                                     |
| 5273 | web app (development)                      | `pnpm dev`                                     |
| 5452 | PostgreSQL (`DB_PORT`)                     | `pnpm db:up`                                   |
| 1045 | Mailpit SMTP (`MAILPIT_SMTP_PORT`)         | `pnpm services:up` (and `pnpm dev`)            |
| 8045 | Mailpit web UI (`MAILPIT_UI_PORT`)         | `pnpm services:up` (and `pnpm dev`)            |
| 3300 | API (end-to-end tests)                     | `pnpm test:e2e`                                |
| 4273 | web app (end-to-end tests, `vite preview`) | `pnpm test:e2e`, `pnpm --filter web preview`   |
| 8180 | production-like stack (`WEB_PORT`)         | `docker compose --profile stack up`            |
| 6389 | Redis (`REDIS_PORT`)                       | `docker compose --profile redis up -d`         |
| 4328 | OTLP/HTTP (`OTLP_HTTP_PORT`)               | `docker compose --profile observability up -d` |
| 3201 | Grafana (`GRAFANA_PORT`)                   | `docker compose --profile observability up -d` |
| 9190 | Prometheus (`PROMETHEUS_PORT`)             | `docker compose --profile observability up -d` |

Every published port listens on 127.0.0.1 only. They differ from the web template's (3000, 5173,
5442, 1035, 8035...): both projects run side by side on one machine.

### 15.2 Accounts

| Account                                                           | Where                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `admin@example.com` / `admin-password`                            | development database (`pnpm db:seed`), end-to-end database                    |
| `auditor@example.com` / `auditor-password`                        | the same; signs in once it sees an application (`pnpm dev:demo` assigns them) |
| `viewer@example.com` / `viewer-password`                          | the same; signs in once it sees an application (`pnpm dev:demo` assigns them) |
| `member@example.com` / `member-password`                          | the same; never signs in: it shows the refusal                                |
| Second factor of the four: key `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` | the same                                                                      |
| PostgreSQL `app` / `app`                                          | the development container only                                                |

They are public: never create them anywhere else.

### 15.3 Where things are

```
apps/api/                 NestJS API
  src/main.ts             entry point (crash handlers, telemetry, then the server)
  src/env/                the validated configuration
  src/ingest/ integrity/ rules/ alerts/ retention/ ...   Audit Hub's features, one folder each
  src/auth/ account/ users/ invitations/ health/        accounts, second factor, health
  src/common/             error filter, request ids, CSRF guard, external HTTP client, pipes
  src/observability/      redaction, error tracking, telemetry, metrics
  src/infrastructure/     Redis, rate limit store, cache, locks and idempotency
  src/lifecycle/          graceful shutdown
  prisma/                 schema.prisma and migrations
  Dockerfile              images api and api-migrate
apps/web/                 React app
  src/api/                the typed client (schema.d.ts is generated)
  src/auth/               session, guards, refresh handling
  src/monitoring/         runtime configuration, error tracking
  src/pages/audit/        the admin pages
  nginx/                  production web server configuration
  Dockerfile              image web
packages/                 the integration contract and the connectors (NestJS, Expo, SPA)
examples/                 the connected example projects: pinned templates and their patches
openapi/openapi.json      the API contract (generated, committed)
e2e/                      Playwright tests
scripts/                  repository tooling (checks, smoke test, tool images, connector)
docs/                     this manual and the guides
  audit/ privacy/         the connection guide, the privacy templates
infra/terraform/          infrastructure as code: the DigitalOcean server and database (optional)
.github/                  workflows, rulesets, Dependabot, templates, pinned tool images
docker-compose.yml        database, optional services, production-like stack
```

### 15.4 The other documents

| Document                                                                                                                                                                                                                                             | Read it for                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [ENGINEERING_STANDARDS.md](../ENGINEERING_STANDARDS.md)                                                                                                                                                                                              | the rules, in one page                 |
| [CONTRIBUTING.md](../CONTRIBUTING.md), [DEFINITION_OF_DONE.md](../DEFINITION_OF_DONE.md), [definition-of-ready.md](definition-of-ready.md)                                                                                                           | how a change reaches `main`            |
| [architecture.md](architecture.md), [api-conventions.md](api-conventions.md), [error-handling.md](error-handling.md), [database.md](database.md)                                                                                                     | how the code is organized              |
| [how-to.md](how-to.md)                                                                                                                                                                                                                               | recipes for the usual changes          |
| [testing.md](testing.md)                                                                                                                                                                                                                             | tests, coverage, budget                |
| [security.md](security.md), [authorization.md](authorization.md), [SECURITY.md](../SECURITY.md)                                                                                                                                                      | controls, limits, per-project settings |
| [environment.md](environment.md)                                                                                                                                                                                                                     | every variable                         |
| [ci-cd.md](ci-cd.md), [branching.md](branching.md), [commits.md](commits.md), [git-hooks.md](git-hooks.md), [code-review.md](code-review.md)                                                                                                         | delivery                               |
| [observability.md](observability.md), [alerting.md](alerting.md), [incident-response.md](incident-response.md), [disaster-recovery.md](disaster-recovery.md), [load-testing.md](load-testing.md), [production-readiness.md](production-readiness.md) | operations                             |
| [audit/connection-guide.md](audit/connection-guide.md)                                                                                                                                                                                               | connecting an application              |
| [privacy/](privacy/README.md)                                                                                                                                                                                                                        | the legal templates                    |
| [design/audit-hub/](design/audit-hub/README.md)                                                                                                                                                                                                      | Audit Hub's design                     |
| [troubleshooting.md](troubleshooting.md)                                                                                                                                                                                                             | messages and fixes                     |
| [adr/](adr/)                                                                                                                                                                                                                                         | why the big decisions were made        |
