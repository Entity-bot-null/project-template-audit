# Step by step: from zero to production

Versión en español: [step-by-step.es.md](step-by-step.es.md). Both versions have the same steps; a
change to one goes to the other in the same pull request.

Audit Hub is a self-hosted audit-log and security service: the applications you connect send it
their security, audit, access and system events through a connector installed in each of them,
and it keeps them sealed, runs detection rules, raises alerts and gives your administrators,
auditors and viewers their own pages.

This is the **instructivo**: what to do, in order, to run an Audit Hub instance for your company,
from the information you need to gather before starting to Audit Hub running in production with
its first application connected, and then the daily loop. It is for the operator who runs the
instance and for the developers who change it. Every step says what to do, the exact command, what
you should see when it worked, and what to do when it did not. The [manual](manual.md) explains
how everything works; this page only tells you what to do next. Connecting each application, in
detail: [audit/connection-guide.md](audit/connection-guide.md). The legal documents:
[privacy/](privacy/README.md).

How to use it:

- Follow the phases in order. Do not skip a **Check**: each one proves the previous steps worked,
  so a problem shows up where it starts, not three phases later.
- Commands run in a terminal at the project's root folder. On Windows use **Git Bash** (installed
  with Git for Windows).
- `<angle brackets>` are values you replace. Write your values in the
  [worksheet](#the-worksheet) as you go.
- Tick the boxes (`[ ]` → `[x]`) in your own copy if it helps.

## The timeline

| Phase                                                                      | What you end up with                                     | Time                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- |
| [0. Information and decisions](#phase-0-information-and-decisions)         | the worksheet filled in, the accounts created            | 1–2 h, plus waiting for accounts |
| [1. Your computer](#phase-1-your-computer)                                 | every tool installed and checked                         | 30–60 min                        |
| [2. Get Audit Hub](#phase-2-get-audit-hub)                                 | your own copy, with your contacts                        | 15 min                           |
| [3. Run it locally](#phase-3-run-it-locally)                               | Audit Hub running on your machine, signed in             | 20 min                           |
| [4. Prove every gate passes](#phase-4-prove-every-gate-passes)             | the same checks as CI, green on your machine             | 30–45 min                        |
| [5. Put it on GitHub](#phase-5-put-it-on-github)                           | the repository protected, CI green on a pull request     | 1 h                              |
| [6. Prepare your instance](#phase-6-prepare-your-instance)                 | the legal documents with counsel; your changes, if any   | days to weeks (counsel's review) |
| [7. Production servers](#phase-7-production-servers)                       | staging and production servers, databases, domains ready | 2–3 h per environment            |
| [8. First deployment](#phase-8-first-deployment)                           | Audit Hub live on staging, then production; your team    | 1 h                              |
| [9. Connect the first application](#phase-9-connect-the-first-application) | a test application sending events, its heartbeat seen    | 1–2 h                            |
| [10. Monitoring and alerts](#phase-10-monitoring-and-alerts)               | errors reported, uptime watched, someone gets the alerts | 1–2 h                            |
| [11. Before real users](#phase-11-before-real-users)                       | the production readiness checklist signed off            | half a day                       |
| [12. The daily loop](#phase-12-the-daily-loop)                             | how every change goes from idea to production            | every day                        |
| [13. The maintenance calendar](#phase-13-the-maintenance-calendar)         | what to do every week, month and quarter                 | recurring                        |

---

## Phase 0. Information and decisions

Nothing to install yet. Gather this first: most delays come from an account or a decision nobody
had when it was needed.

### 0.1 Decide

- [ ] **Repository name** for your copy of Audit Hub (lowercase, dashes: `acme-audit-hub`).
- [ ] **Domains** for Audit Hub: one for production and one for staging. This guide writes
      `app.acme.com` and `staging.acme.com`; use yours (`audit.acme.com`, for example). You need
      access to the domain's DNS settings.
- [ ] **Where it runs.** This guide uses the ready-made target: **one Linux server per
      environment** with Docker and a managed PostgreSQL ([deploy-vps.md](deploy-vps.md)). It suits
      a first deployment (one instance of the API). For Kubernetes or a container platform, phases
      0–6 are the same and phase 7 is replaced by your platform ([ci-cd.md](ci-cd.md#deployment)).
- [ ] **Who** approves production deployments (at least one person besides the author), who
      reviews code (CODEOWNERS), who receives security reports and alerts.
- [ ] **The applications to connect**, and in which environments: one application in Audit Hub
      per backend and per environment (production and staging are two), as the connection guide's
      [Which applications to register](audit/connection-guide.md#which-applications-to-register)
      explains. Choose the first one: a test application, or the staging environment of a real
      one (phase 9).
- [ ] **Who signs in to Audit Hub:** the administrators (at least two: nobody resets their own
      second factor, and a response action needs a second administrator's approval by default),
      the auditors and the viewers, and the applications each auditor or viewer sees. They come by
      invitation (phase 8), auditors and viewers with their applications, and every account sets
      up an authenticator app (TOTP) at its first sign-in. There is no public sign-up.
- [ ] **Retention per application:** the minimums apply unless you set more (security 730 days,
      audit 365, access 180, system 30, audit access 730, personal data 90, coordinates 30:
      [database.md](database.md#audit-hubs-audit-tables)). Write down the applications whose
      contract or law asks for longer.
- [ ] **Alert channels:** email (an SMTP provider: the same one sends the invitations), and a
      Slack channel or a Teams workflow if you use one ([manual 11.6](manual.md#116-audit-hub-alert-notifications-and-ip-geolocation));
      who reads them.
- [ ] **IP geolocation** (optional): the free DB-IP Lite files, downloaded every month to each
      server ([deploy-vps.md](deploy-vps.md#ip-geolocation)). Without them the country, impossible
      travel and hosting rules do not run.
- [ ] **Where the integrity checkpoint digests are kept:** a place outside Audit Hub that whoever
      holds its server, database and `AUDIT_INTEGRITY_KEY` cannot change alone (a checkpoint is
      made every day; [security.md](security.md#audit-log-integrity-retention-and-erasure)), and
      how often you copy the last one there.
- [ ] **The legal role** ([privacy/README.md](privacy/README.md#roles)): for your clients'
      applications you are their processor (encargado) and each client is the controller
      (responsable), with a processor contract
      ([processor-contract.md](privacy/processor-contract.md)) for each; for your own company's
      applications that contract becomes an internal policy. For Audit Hub's own users you are the
      controller, with a privacy notice of your own. Counsel reviews every document (phase 6).

### 0.2 Create the accounts

| Account                                                    | For                                          | Notes                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub (an organization is better than a personal account) | code, CI, images, deployments                | Access to Audit Hub's repository (private for now). A **private** repository needs **GitHub Team** (organization) or **Pro** (personal): environments with required reviewers and their secrets, rulesets and branch protection depend on it. On the Free plan they exist only for public repositories |
| A cloud or VPS provider                                    | the servers (2 vCPU, 4 GB RAM each)          | any provider with Ubuntu 24.04 and a public IPv4                                                                                                                                                                                                                                                       |
| A managed PostgreSQL                                       | the databases (16 or newer)                  | often the same provider; automated backups and point-in-time recovery required                                                                                                                                                                                                                         |
| The domain's DNS                                           | `A` records to the servers                   | the registrar or a DNS service                                                                                                                                                                                                                                                                         |
| An email provider (SMTP)                                   | invitations, password recovery, alert emails | Amazon SES, Postmark, Resend, Brevo...; SPF, DKIM and DMARC on the sending domain                                                                                                                                                                                                                      |
| Slack or Microsoft Teams (optional)                        | alert messages                               | an incoming webhook of a Slack channel, or a Teams workflow started by "when a Teams webhook request is received"                                                                                                                                                                                      |
| An authenticator app, for each person                      | every account's second factor                | Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden...                                                                                                                                                                                                                                 |
| Sentry (optional)                                          | error reports from the API and the browser   | free tier is enough to start                                                                                                                                                                                                                                                                           |
| An uptime monitor (optional but recommended)               | an alert when the site is down               | any service that checks a URL from several places                                                                                                                                                                                                                                                      |
| A password manager                                         | the secrets of this guide                    | shared vault for the team                                                                                                                                                                                                                                                                              |

### The worksheet

Copy this into your password manager or notes and fill it in as you go. Secrets go only in the
password manager.

| Item                                                                                        | Value            | Phase |
| ------------------------------------------------------------------------------------------- | ---------------- | ----- |
| GitHub owner / repository                                                                   | `OWNER/REPO`     | 0     |
| Production domain / staging domain                                                          |                  | 0     |
| The operator: company name and privacy contact (for the legal documents)                    |                  | 0, 6  |
| First applications to connect (name, slug, environment)                                     |                  | 0, 9  |
| Administrators (two at least), auditors and viewers, with the applications each one sees    |                  | 0, 8  |
| Applications whose retention is longer than the minimums, and how long                      |                  | 0, 9  |
| Where the checkpoint digests are kept, and how often they are copied                        |                  | 0, 11 |
| Production server IP / staging server IP                                                    |                  | 7     |
| Database host (production / staging)                                                        |                  | 7     |
| `app_migrator` password (per environment)                                                   | password manager | 7     |
| `app_runtime` password (per environment)                                                    | password manager | 7     |
| `JWT_ACCESS_SECRET` (per environment, and one for your machine)                             | password manager | 3, 7  |
| `AUDIT_SECRETS_KEY` (per environment; losing it loses Audit Hub's stored secrets)           | password manager | 3, 7  |
| `AUDIT_INTEGRITY_KEY` (per environment; signs the audit log's seals)                        | password manager | 3, 7  |
| SMTP: `MAIL_SMTP_URL` (provider, user, password) and `MAIL_FROM`                            | password manager | 7     |
| Slack or Teams webhook URL (`AUDIT_SLACK_WEBHOOK_URL`, `AUDIT_TEAMS_WEBHOOK_URL`; optional) | password manager | 7     |
| Deploy SSH key (per environment)                                                            | password manager | 7     |
| `RELEASE_PLEASE_TOKEN` (optional)                                                           | password manager | 5     |
| First administrator's email                                                                 |                  | 8     |
| Each application's variables (`AUDIT_HUB_*`, shown once)                                    | password manager | 9     |
| Sentry DSNs (API, web)                                                                      |                  | 10    |

**Check:** every account above exists and you can sign in to each one; the decisions of 0.1 have
an answer.

---

## Phase 1. Your computer

### 1.1 Install the tools

| Tool                | Install                                                                                                                                                                      | Check command            | Expected                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| Git                 | Windows: [Git for Windows](https://git-scm.com/download/win) (includes Git Bash and `openssl`); macOS: `xcode-select --install`; Linux: your package manager                 | `git --version`          | any current version                                          |
| Node.js 24          | [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux): `nvm install 24`; Windows: [fnm](https://github.com/Schniz/fnm) or the [official installer](https://nodejs.org) (24 LTS) | `node --version`         | `v24.15.0` or later                                          |
| pnpm                | `corepack enable` (once; Node.js 24 includes Corepack, from Node.js 25 install it first: `npm install -g corepack`)                                                          | `pnpm --version`         | `12.5.1` (inside the project)                                |
| Docker              | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) or Docker Engine (Linux)                                                                  | `docker compose version` | `Docker Compose version v2` or later                         |
| GitHub CLI          | [cli.github.com](https://cli.github.com)                                                                                                                                     | `gh --version`           | any current version                                          |
| VS Code (suggested) | [code.visualstudio.com](https://code.visualstudio.com)                                                                                                                       |                          | it offers the project's recommended extensions on first open |

**Check:** each check command prints the expected value. Docker Desktop is running (its icon shows
"Docker Desktop is running").

**If it fails:**

- `node` prints an older version: `nvm use 24` / `fnm use 24`, then open a new terminal.
- `pnpm` is not found: run `corepack enable` again in a terminal opened as administrator
  (Windows) or with `sudo` (macOS/Linux). `corepack` is not found (Node.js 25 or later):
  `npm install -g corepack`, or `npm install -g pnpm@12.5.1`.
- `docker compose version` fails: start Docker Desktop and wait until it says it is running.

### 1.2 Sign in to GitHub from the terminal

```
gh auth login
```

Choose GitHub.com, HTTPS, and sign in with the browser.

**Check:** `gh auth status` says `Logged in to github.com account <you>`.

### 1.3 Configure Git (once per computer)

```
git config --global user.name "<Your Name>"
git config --global user.email "<you@acme.com>"
git config --global init.defaultBranch main
```

**Check:** `git config --global --list` shows the three values.

---

## Phase 2. Get Audit Hub

### 2.1 Get Audit Hub's code

Audit Hub's repository is private for now: ask its owner for access to
`<Audit Hub repository URL>`. Your instance needs a GitHub repository of its own (phase 5): its CI,
its images and its deployments run there.

Easiest, when you can see Audit Hub's repository on GitHub: **Fork**, owner `OWNER`, name `REPO`
(a fork of a private repository is private too). Then clone your fork:

```
gh repo clone OWNER/REPO
cd REPO
```

Otherwise, clone Audit Hub's repository; phase 5 gives it a repository of yours:

```
git clone <Audit Hub repository URL> REPO
cd REPO
```

Keep the history either way: `CHANGELOG.md` and the version (`.release-please-manifest.json`)
continue from it.

**Check:** `ls` shows `apps`, `packages`, `docs`, `package.json`, `docker-compose.yml`.

### 2.2 Fill in your contacts

Open the project in your editor (`code .`) and change:

| File                 | Change                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| `SECURITY.md`        | `security@example.com` → your security contact; the response times, if yours differ |
| `.github/CODEOWNERS` | replace `@your-org/...` with real users or teams and remove the `#`                 |
| `README.md`          | the title and the first paragraph, only if you rebrand Audit Hub                    |

Leave the rest as it is: the package names, the page and API titles, `CHANGELOG.md` and the
version are Audit Hub's.

**Check:** searching the project for `example.com` finds only examples and placeholders for later:
the `.env.example` files (those of `deploy/vps` too), tests, the development seed accounts, comments
and documentation, and the defaults of `infra/`, `dast.yml` and the smoke test (phases 7 to 10);
searching for `REQUIERE CONFIGURACIÓN` lists the items still open (most are in later phases).

---

## Phase 3. Run it locally

### 3.1 Install the dependencies

```
corepack enable
pnpm install
```

**Check:** `pnpm install` ends with `Done in …`, and `git config core.hooksPath` prints `.husky/_`
(the Git hooks are installed).

**If it fails:** `ERR_PNPM_UNSUPPORTED_ENGINE` → Node.js is older than 24.15 (phase 1).
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` → a dependency is younger than seven days (the supply-chain
policy): wait a day or see [troubleshooting.md](troubleshooting.md).

### 3.2 Create your local configuration

```
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32
```

Open `apps/api/.env` and paste the printed value after `JWT_ACCESS_SECRET=`. Nothing else is needed
locally.

**Check:** `grep -cE '^JWT_ACCESS_SECRET=[0-9a-f]{64}$' apps/api/.env` prints `1` (the secret is
set, without printing it). `git status` does **not** list `apps/api/.env` (it is ignored: never
commit it).

### 3.3 Start the database

```
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

**Check:** `db:up` ends with `Container … Healthy`; `db:migrate` says the migrations were applied;
`db:seed` prints the development accounts, one per role, and their second factor:

```
Seeded:
  admin   admin@example.com / admin-password
  auditor auditor@example.com / auditor-password
  viewer  viewer@example.com / viewer-password
  member  member@example.com / member-password
Second factor of every account (authenticator app, "enter a key"): JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
```

Add that key to an authenticator app on your phone (Google Authenticator, Microsoft
Authenticator, 1Password, Bitwarden...: "enter a key", time-based). Every sign-in asks for its
code after the password. Without a phone, `pnpm dev:totp` in another terminal prints the current
code. Sign in as the administrator: the auditor and the viewer sign in once they see an
application (`pnpm dev:demo` assigns them its own), and the member never does (it shows the
refusal: "Your account does not have administrative access to this panel").

**If it fails:** `port is already allocated` (port 5452 taken or, on Windows, reserved) → create
the root `.env` with `cp .env.example .env`, set `DB_PORT=5443` in it, change the port in
`DATABASE_URL` of `apps/api/.env` to `5443`, and repeat.

### 3.4 Start the app

```
pnpm dev
```

**Check**, in your browser:

| Open                                                                           | You should see                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| http://localhost:5273                                                          | the sign-in page                                |
| sign in as `admin@example.com` / `admin-password`, then the code of the app    | the Overview of the admin pages                 |
| sign out, sign in as `member@example.com` / `member-password`, then a new code | the Home page only: a member sees no audit data |
| http://localhost:3200/api/docs                                                 | the API documentation (Swagger)                 |
| http://127.0.0.1:3200/api/health/ready                                         | a JSON answer with `"status":"ok"`              |
| http://localhost:8045                                                          | Mailpit, where the app's email lands            |

The terminal shows the API's first line:
`Starting release unversioned in development: … error tracking off, Redis off, email on`, and a
box with these addresses under the logs. `pnpm --filter api mail test --to you@example.test`
queues a test message: it appears in Mailpit within seconds.

The admin pages stay empty until an application sends events. To see them full, run
`pnpm dev:demo` once in another terminal while `pnpm dev` runs: it registers three demo
applications and sends three weeks of their activity, and a few attacks raise alerts within five
minutes ([manual 2.6](manual.md#26-run-it)).

Stop with `Ctrl+C`. Tomorrow, `pnpm dev` is enough.

---

## Phase 4. Prove every gate passes

Run once now: if your machine passes what CI runs, a red CI later means a real problem in a change,
not a setup problem.

### 4.1 The main gate

```
pnpm verify
```

It runs, in order: formatting, lint, types, unit and component tests with coverage, the security
checks (vulnerabilities, licenses, secrets), the build and the performance budget. It takes a few
minutes.

**Check:** it ends without errors; the coverage summary appears and the budget lines say `ok`.

### 4.2 Integration and browser tests

```
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

**Check:** both report their tests passed (`passed`, no `failed`); the integration run also lists
the Redis adapter suite as skipped, which runs where `REDIS_TEST_URL` is set (CI). The end-to-end
tests use ports 3300 and 4273: stop `pnpm dev` first.

### 4.3 The Docker-based checks

```
pnpm sast
pnpm lint:workflows
pnpm observability:check
```

**Check:** Semgrep ends with `0 findings`; the workflow check prints `No findings to report`; the
observability check prints a line starting with `ok` (dashboards, alerts, metric names), then
promtool's `SUCCESS` for each of its steps. `pnpm sast` takes a few minutes (it scans a temporary
copy of the files git tracks); the first run also pulls the Semgrep image.

### 4.4 The production images on your machine

Set three secrets for the local production stack in the root `.env` (create it with
`cp .env.example .env` if you have not): open it and paste the values the first three commands print
after `JWT_ACCESS_SECRET=`, `AUDIT_SECRETS_KEY=` and `AUDIT_INTEGRITY_KEY=`, then start the stack:

```
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
docker compose --profile stack up --build
```

In a second terminal:

```
pnpm smoke --url http://localhost:8180
```

**Check:** the smoke test ends with `Smoke test passed (public URL only).` and http://localhost:8180
shows the app. The stack uses the development database (the same `db` service and volume), so the
accounts of 3.3 sign in there too.

Stop: `Ctrl+C`, then `docker compose --profile stack down`.

---

## Phase 5. Put it on GitHub

### 5.1 First commit and push

If you forked Audit Hub's repository (2.1), `origin` is your fork already. On GitHub, open the
fork's **Actions** tab and enable its workflows (GitHub leaves them off in a fork). Otherwise, keep
Audit Hub's repository as `upstream` and create yours:

```
git remote rename origin upstream
gh repo create OWNER/REPO --private --source . --remote origin
```

Then:

```
git add -A
git commit -m "chore: set the security contact and code owners"
git push --no-verify -u origin main
```

The commit runs the pre-commit checks on the files you changed (a few seconds). `--no-verify` is
only for this first push: from now on the hook refuses pushes to `main`.

**Check:** the repository on GitHub shows your files and Audit Hub's history; the **Actions** tab
shows a **CI** run on `main` (it should end green).

### 5.2 Repository settings

In GitHub → **Settings**:

1. **General → Pull Requests**: allow only **squash merging**; default commit message
   "**Pull request title**"; tick **Automatically delete head branches**.
2. **Actions → General → Workflow permissions**: **Read repository contents and packages
   permissions**, and tick **Allow GitHub Actions to create and approve pull requests** (the
   **Release** workflow opens the release pull request with the workflow's token).
3. **Environments → New environment** `staging`: **Deployment branches and tags → Selected
   branches and tags → Add rule `main`**.
4. **Environments → New environment** `production`: the same rule for `main`, and **Required
   reviewers** (the people of 0.1; tick **Prevent self-review**).
5. **Code security**: enable **Dependabot alerts**, **Dependabot security updates**, **Secret
   scanning** with **Push protection** (if your plan offers them), **Private vulnerability
   reporting**.
6. **Rules → Rulesets**: import both files, or with the CLI:

   ```
   gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/main.json
   gh api repos/OWNER/REPO/rulesets --method POST --input .github/rulesets/tags.json
   ```

   Rulesets need a public repository or GitHub Team. With GitHub Pro (a personal account), use
   **Branches → Add branch protection rule** for `main` instead: require a pull request with one
   approval and the status checks **CI passed** and **Conventions**. On the Free plan with a
   private repository none of this (and no environment of steps 3–4) is available: make the
   repository public or upgrade before going on; otherwise the protections of this guide exist only
   on paper. Two workflows make up for part of it on any plan: `main-guard.yml` reports a push to
   `main` that is not a merged pull request, and `dependabot-auto-merge.yml` checks the approval and
   CI itself. Nothing replaces the required reviewers of a deployment
   ([ci-cd.md](ci-cd.md#required-check)).

**Check:** **Settings → Environments** lists `staging` and `production`, both limited to `main`;
**Rules** (or branch protection) shows the rule for `main`.

### 5.3 The token for release pull requests

Optional, the release token: without it, the **Release** workflow starts CI on the release pull
request itself, and the conventions check (**CI passed** and **Conventions**, the two checks the
ruleset requires). With a GitHub App token or a **fine-grained personal access token**, saved as
`RELEASE_PLEASE_TOKEN`, the release pull request runs every pull request workflow, like a person's
([ci-cd.md](ci-cd.md#release-pull-requests)). The fine-grained token:

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token**.
2. Resource owner `OWNER`; **Only select repositories** → `REPO`; expiration as your policy says.
3. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**,
   **Issues: Read and write**.
4. Generate, copy, then:

   ```
   gh secret set RELEASE_PLEASE_TOKEN
   ```

   and paste it when asked.

**Check:** if you set the release token, `gh secret list` shows `RELEASE_PLEASE_TOKEN`; write its
expiration date in the [maintenance calendar](#phase-13-the-maintenance-calendar).

### 5.4 Prove the pull request flow

```
git switch -c chore/check-pipeline
printf '\nThis instance is operated by Acme.\n' >> README.md
git commit -am "docs: check the pipeline"
git push -u origin HEAD
gh pr create --fill
gh pr checks --watch
```

**Check:** the pull request shows **CI passed** green (about 15 minutes the first time) and, with
the ruleset, cannot be merged without an approval. Merge it (**Squash and merge**).

A `docs` or `chore` change releases nothing by itself: the **Release** workflow opens a release
pull request once `main` has a `feat` or `fix` that no release includes yet, and starts CI and
Conventions on it (**CI passed** and **Conventions** green on that pull request a few minutes
later). Leave it open: merge it when you want to cut your first release (phase 8).

---

## Phase 6. Prepare your instance

Most of this phase is waiting for counsel: start it now, and go on with phases 7 to 9 meanwhile.

1. **The legal documents.** [privacy/](privacy/README.md) holds templates, not legal advice: the
   processor contract, the paragraphs each connected application adds to its privacy notice, an
   impact assessment and the ARCO procedure. In your own copies, fill in every placeholder in
   [square brackets] with the role decided in 0.1, and hand them to counsel, who answers each
   point marked "Needs legal review" and prepares the binding Spanish text
   ([Before using them](privacy/README.md#before-using-them)). Audit Hub's own users need a
   privacy notice of yours too.
2. **How accounts are created.** Audit Hub has sign-in with a second factor for every account,
   the roles `member` (who cannot sign in), `viewer`, `auditor` and `admin`, invitations by
   administrators (with email; auditors and viewers with the applications they will see),
   password recovery and change, and change of email. There is no public sign-up
   (`SIGN_UP_ENABLED=true` stops the boot). The first administrator, and every account while
   email is off, are created with the `create-user` command
   ([phase 8](#84-create-the-first-administrator)).
3. **Changes to Audit Hub** (optional; most instances run it as it is). Each one follows
   [the daily loop](#phase-12-the-daily-loop): a branch, a pull request, CI, review, merge. The
   detection rules' thresholds (`apps/api/src/rules/rules.constants.ts`) are starting points, tuned
   with real traffic ([security.md](security.md#detection-rules)); any other change follows the
   recipes of [how-to.md](how-to.md), and [the design package](design/audit-hub/README.md) says
   why Audit Hub is built the way it is.
4. **Optional services**, only if needed: Redis (more than one API instance), OpenTelemetry
   (traces and metrics): [manual.md](manual.md#11-optional-infrastructure).

**Check:** the documents are with counsel; for each change of yours, `pnpm verify` passes locally
and **CI passed** is green on its pull request.

Do phases 7 and 8 early: every merged change can then be tried on a real server.

---

## Phase 7. Production servers

Do this phase twice: once for **staging**, once for **production**. The commands use
`app.acme.com`; use the domain of the environment you are setting up.

Steps 7.1 to 7.5 build the server and the database by hand, with any provider. On DigitalOcean,
Terraform can build the same ones instead: do 7.0, skip 7.1 to 7.5, and go on at 7.6.

### 7.0 On DigitalOcean, 7.1 to 7.5 with Terraform (optional)

What Terraform creates, what it costs and why:
[deploy-vps.md](deploy-vps.md#provision-with-terraform-digitalocean). You need Terraform 1.16.5 or a
later 1.16 ([developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install);
`terraform version` prints `Terraform v1.16.` and a patch number of 5 or more) and a DigitalOcean API token
that can write (**API → Tokens**).

On your computer, the deploy key of this environment (as in 7.4), then the settings file:

```
ssh-keygen -t ed25519 -N "" -C "github-deploy-production" -f deploy_production
cd infra/terraform/digitalocean
cp terraform.tfvars.example production.tfvars
```

Edit `production.tfvars`: `project_name`, `environment`, `domain`, your SSH public key
(`admin_ssh_public_key`, the content of your `~/.ssh/id_ed25519.pub`), the content of
`deploy_production.pub` (`deploy_ssh_public_key`) and `alert_emails` (verified members of your
DigitalOcean team). Keep `admin_cidrs = ["0.0.0.0/0"]`: GitHub's runners connect over SSH from
addresses that change. Then (paste the token when `read` waits, then Enter):

```
read -rs DIGITALOCEAN_TOKEN && export DIGITALOCEAN_TOKEN
terraform init
terraform workspace new production
terraform plan -var-file=production.tfvars -out=production.tfplan
terraform apply production.tfplan
rm production.tfplan
ssh "$(terraform output -raw ssh_admin)" cloud-init status --wait
```

The first SSH connection asks whether to trust the server's key: compare its fingerprint with the
one the server shows in DigitalOcean's **Droplet Console** (log in as `ops`, run
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Then point the domain at the server, unless
`manage_dns = true` did it: the record `terraform output dns_record` shows, at your DNS provider.
Last, the database roles and the server's key for GitHub:

```
cd ../../..
pnpm iac:database
ssh-keyscan -t ed25519 app.acme.com > known_hosts_production
```

**Check:** `cloud-init status --wait` ends with `status: done`; `pnpm iac:database` ends with
`Done: the database app (owner app_migrator) and the role app_runtime.`;
`ssh -i deploy_production deploy@app.acme.com 'docker ps'` prints an empty table (headers only);
`ssh-keygen -lf known_hosts_production` shows the fingerprint you compared.

**If it fails:**

| Message                                              | Cause and fix                                                                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`, `Unable to authenticate you`                  | `DIGITALOCEAN_TOKEN` is not exported in this terminal, or the token cannot write                                                                                                                                       |
| `Invalid value for variable`                         | the value it names in `production.tfvars`; `variables.tf` says what each one accepts                                                                                                                                   |
| `SSH Key is already in use on your account`          | this deploy key is in DigitalOcean already (another environment, an earlier attempt): one deploy key per environment, or remove the old one there (**Settings → Security**)                                            |
| `Provider produced inconsistent result after apply`  | the new reserved IP showed late in DigitalOcean's API: `terraform import -var-file=production.tfvars digitalocean_reserved_ip.app <address>` (the address in **Networking → Reserved IPs**), then plan and apply again |
| `The workspace (...) is not the environment (...)`   | `terraform workspace select production`                                                                                                                                                                                |
| `status: error`                                      | `/var/log/cloud-init-output.log` on the server says which command failed                                                                                                                                               |
| `pnpm iac:database`: `Permission denied (publickey)` | your SSH key is not the one in `admin_ssh_public_key`                                                                                                                                                                  |

### 7.1 Create the server

In your provider's console: a server with **Ubuntu 24.04 LTS**, 2 vCPU and 4 GB RAM or more, a
public IPv4, your personal SSH public key for the first login. If the provider has a firewall,
allow TCP 22, 80 and 443, and UDP 443.

**Check:** `ssh root@<server IP>` (or the user the provider names) opens a shell on the server.

### 7.2 Point the domain at it

At your DNS provider: an **A** record `app.acme.com` → the server's IPv4. No **AAAA** record: the
deployment serves IPv4 only ([deploy-vps.md](deploy-vps.md#2-create-the-server) says why).

**Check**, after a few minutes: `nslookup app.acme.com` answers the server's address.

### 7.3 Install Docker and close the firewall

Connected to the server, copy these lines one block at a time:

```
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

**Check:** `docker compose version` prints `Docker Compose version v2` or later; `sudo ufw status` lists
OpenSSH, 80 and 443 as `ALLOW`.

### 7.4 Create the deploy user

On the server:

```
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 755 -o deploy -g deploy /srv/app
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

On **your computer**, a key for GitHub to connect with (one per environment; no passphrase):

```
ssh-keygen -t ed25519 -N "" -C "github-deploy-production" -f deploy_production
scp deploy_production.pub <your user>@app.acme.com:/tmp/deploy.pub
ssh <your user>@app.acme.com 'sudo install -m 600 -o deploy -g deploy /tmp/deploy.pub /home/deploy/.ssh/authorized_keys && rm /tmp/deploy.pub'
ssh-keyscan -t ed25519 app.acme.com > known_hosts_production
```

**Check:** `ssh -i deploy_production deploy@app.acme.com 'docker ps'` prints an empty table
(headers only). Compare the key in `known_hosts_production` with the host key your provider's
console shows (or run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server and
`ssh-keygen -lf known_hosts_production` on your computer: the fingerprints must match).

### 7.5 Create the database

In your provider's console, a managed **PostgreSQL 16 or newer**: same region as the server,
**automated backups** and **point-in-time recovery** on, **deletion protection** on, access only
from the server's IP (or a private network). Note its host name.

Generate two passwords (`openssl rand -hex 24`, twice) and save them in the password manager. Then,
connected as the provider's administrator (`psql "<admin connection string>"`):

```sql
CREATE ROLE app_migrator LOGIN PASSWORD '<migrator password>';
GRANT app_migrator TO CURRENT_USER;
CREATE DATABASE app OWNER app_migrator;
CREATE ROLE app_runtime LOGIN PASSWORD '<runtime password>' CONNECTION LIMIT 50;
```

Then connected **as `app_migrator`** to the database `app`
(`psql "postgresql://app_migrator:<migrator password>@<host>:5432/app?sslmode=require"`):

```sql
GRANT CONNECT ON DATABASE app TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
```

**Check:** each statement answers `CREATE ROLE`, `GRANT ROLE`, `CREATE DATABASE`, `GRANT` or
`ALTER DEFAULT PRIVILEGES`, without errors. Without `GRANT app_migrator TO CURRENT_USER`,
PostgreSQL 16 and later refuse `CREATE DATABASE` (`must be able to SET ROLE "app_migrator"`): the
providers' administrators are not superusers. The migrator will own and change the schema; the
API connects as `app_runtime`, which reads and writes data only.

### 7.6 Put the deployment files on the server

From the project folder on your computer:

```
scp deploy/vps/* deploy@app.acme.com:/srv/app/
```

Later, when a release changes one of these files (Dependabot updates the Caddy image in
`deploy/vps`), the Deploy workflow stops at **Check the server's deploy files** until you copy them
again ([deploy-vps.md](deploy-vps.md#update-the-server-files)).

On the server, as `deploy` (`ssh -i deploy_production deploy@app.acme.com`):

```
cd /srv/app
chmod 755 deploy.sh rollback.sh
cp server.env.example server.env
cp api.env.example api.env
cp migrate.env.example migrate.env
cp web.env.example web.env
chmod 600 api.env migrate.env
openssl rand -hex 32
```

Edit each file (`nano <file>`, save with `Ctrl+O`, exit with `Ctrl+X`):

| File          | Set                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.env`  | `APP_DOMAIN=app.acme.com`                                                                                                                                                                                                                                                                                                |
| `api.env`     | `DATABASE_URL=postgresql://app_runtime:<runtime password>@<db host>:5432/app?sslmode=require`, `JWT_ACCESS_SECRET=<the value openssl printed>`, `AUDIT_SECRETS_KEY=<another value openssl printed>`, `AUDIT_INTEGRITY_KEY=<a third one>`, `APP_ENVIRONMENT=production` (or `staging`), `APP_ORIGIN=https://app.acme.com` |
| `migrate.env` | `DATABASE_URL=postgresql://app_migrator:<migrator password>@<db host>:5432/app?sslmode=require`                                                                                                                                                                                                                          |
| `web.env`     | `APP_ENVIRONMENT=production` (or `staging`)                                                                                                                                                                                                                                                                              |

With Terraform (7.0), the two `DATABASE_URL` values are complete already: in
`infra/terraform/digitalocean` on your computer, `terraform output -raw database_runtime_url`
(`api.env`) and `terraform output -raw database_migrator_url` (`migrate.env`).

On DigitalOcean or Amazon RDS, whose certificates come from the provider's own CA, end both URLs
with `?sslmode=require&uselibpqcompat=true` instead (the Terraform outputs already do): the API
would otherwise refuse the certificate (a certificate error such as
`self-signed certificate in certificate chain`,
[deploy-vps.md](deploy-vps.md#6-the-files-on-the-server)).

**Email** (optional, but Audit Hub's invitations, password recovery and alert emails need it;
without it the rest runs): in `api.env`, `MAIL_SMTP_URL=smtps://<user>:<password, percent-encoded>@<provider host>:465` and
`MAIL_FROM="Acme <no-reply@acme.com>"` from your email provider (Amazon SES, Postmark, Resend,
Brevo...), and at the provider, SPF, DKIM and DMARC for `acme.com`
([manual](manual.md#115-email)). After the first deployment (phase 8),
`docker compose --env-file server.env --env-file release.env run --rm -T api node dist/infrastructure/mail/mail.cli.js test --to <you>`
must print `Delivered`. If it ends in `connection` or a timeout, the server may not be allowed to
send SMTP (DigitalOcean blocks ports 25, 465 and 587 on many accounts): use the provider's port 2525
(`smtp://<user>:<password>@<provider host>:2525`, STARTTLS) or ask DigitalOcean's support.

**Alert channels** (optional): in `api.env`, `AUDIT_SLACK_WEBHOOK_URL=<the Slack incoming webhook>`
or `AUDIT_TEAMS_WEBHOOK_URL=<the Teams workflow's URL>`: new alerts from medium severity, and
those nobody acknowledges again as each severity's escalation says (set under **Detection rules**)
([manual](manual.md#116-audit-hub-alert-notifications-and-ip-geolocation)). **IP geolocation**
(optional): the files and the `GEOIP_*` variables of
[deploy-vps.md](deploy-vps.md#ip-geolocation), in `/srv/app/geoip` and `api.env`.

**Check:** `ls -l /srv/app` shows `api.env` and `migrate.env` as `-rw-------` (only `deploy` can
read them), and `grep -c '<' *.env` prints `0` for each file (no placeholder left).

### 7.7 Tell GitHub about the server

Once for the repository:

```
gh variable set DEPLOY_TARGET --body vps
gh variable set IMAGE_PREFIX --body ghcr.io/<owner>/<repo>
```

(`IMAGE_PREFIX` in lowercase: `ghcr.io/acme/acme-portal`.)

For the environment you are setting up (`production` here; `staging` the other time):

```
gh variable set DEPLOY_HOST --env production --body app.acme.com
gh variable set PUBLIC_URL --env production --body https://app.acme.com
gh secret set DEPLOY_SSH_KEY --env production < deploy_production
gh secret set DEPLOY_KNOWN_HOSTS --env production < known_hosts_production
```

Save `deploy_production` in the password manager, then delete it and `known_hosts_production` from
your computer.

**Check:** **Settings → Environments → production** lists the variables `DEPLOY_HOST`,
`PUBLIC_URL` and the secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; **Settings → Secrets and
variables → Actions → Variables** lists `DEPLOY_TARGET` and `IMAGE_PREFIX`.

Now repeat the phase for the other environment: 7.0 or 7.1–7.5, then 7.6 and 7.7.

---

## Phase 8. First deployment

### 8.1 Deploy to staging

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=main
gh run watch
```

It takes 15–25 minutes the first time. The jobs, in order: Resolve the commit → Gates → Publish
api / api-migrate / web → Release to staging (server).

**Check:** the run ends green; its summary lists the three image digests; the last step prints
`Smoke test passed (public URL only).`; https://staging.acme.com opens the sign-in page with a
valid certificate (the padlock).

**If it fails:**

| Failing step                                                | Cause and fix                                                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates                                                       | the same as a red CI: open the failing job's log ([troubleshooting.md](troubleshooting.md))                                                                                 |
| Publish: "The registry is ghcr.io"                          | `IMAGE_PREFIX` must be `ghcr.io/<owner>/<repo>` in lowercase (7.7)                                                                                                          |
| Publish: "Scan the pushed image"                            | a fixable HIGH or CRITICAL advisory in the pushed image, as in the gates' image scan: update the base image or the dependency ([security.md](security.md#container-images)) |
| Environment settings                                        | a variable or secret of the environment is missing (7.7)                                                                                                                    |
| Deploy on the server: `Permission denied (publickey)`       | the public key is not in `/home/deploy/.ssh/authorized_keys`, or the wrong private key in `DEPLOY_SSH_KEY` (7.4)                                                            |
| `Host key verification failed`                              | `DEPLOY_KNOWN_HOSTS` does not match the server (7.4)                                                                                                                        |
| Check the server's deploy files: "Server files out of date" | a release changed a file in `deploy/vps`: copy the files again ([deploy-vps.md](deploy-vps.md#update-the-server-files))                                                     |
| `server.env is missing`                                     | 7.6 not done on that server                                                                                                                                                 |
| The migration failed                                        | `migrate.env`: wrong password, host, or the database is not reachable from the server (7.5)                                                                                 |
| The rollout failed                                          | the step's log ends with the new containers' last log lines, then the previous release starts again; usually `api.env` (`DATABASE_URL`, `JWT_ACCESS_SECRET`)                |
| Smoke test, certificate errors                              | DNS does not point at the server yet, or ports 80/443 are closed (7.2, 7.3)                                                                                                 |

### 8.2 Look at it

Open https://staging.acme.com. The sign-in page loads; nobody can sign in yet: production databases
have no accounts.

### 8.3 Cut the first release and deploy it to production

1. Merge the release pull request, "chore(main): release <version>" (5.4: it exists once `main`
   has a `feat` or `fix` that no release includes). The version continues from
   `.release-please-manifest.json` (`0.1.0` now): before 1.0.0, a `fix` makes the next patch
   (0.1.1) and a `feat` the next minor (0.2.0). To choose the first version instead,
   first merge a pull request with the footer `Release-As: <version>` added to its commit message in
   the **Squash and merge** dialog. If the release pull request offers **Update branch**, press it
   first ([ci-cd.md](ci-cd.md#release-pull-requests)). The **Release** workflow creates the tag
   `v<version>` and the GitHub release.
2. Deploy that tag to staging, then to production:

   ```
   gh workflow run deploy.yml --ref main -f environment=staging -f ref=v<version>
   gh run watch
   gh workflow run deploy.yml --ref main -f environment=production -f ref=v<version>
   ```

3. The production run stops at **Release to production (server)** waiting for approval: a
   reviewer opens the run on GitHub → **Review deployments** → **Approve and deploy**.

**Check:** both runs end green; production builds nothing (its summary lists the three digests of
the staging run, "built and scanned by run <its id>"); https://app.acme.com opens the sign-in page.

### 8.4 Create the first administrator

On each server (staging and production), as `deploy`:

```
cd /srv/app
read -rs PASSWORD
```

Type the password (15 characters or more, a few words work well; nothing is shown), press
Enter, then:

```
printf '%s' "$PASSWORD" | docker compose --env-file server.env --env-file release.env \
  run --rm -T api node dist/users/create-user.cli.js \
  --email <first admin email> --name "<Name>" --role admin
unset PASSWORD
```

**Check:** it prints `Created the admin account <email> (<id>).`

Sign in at the site with that email and password. The first sign-in sets up the second factor:
scan the QR code with your authenticator app (or type the key shown under "Can't scan it?"), enter
its code, and keep the 10 recovery codes it shows once somewhere only you can open (your own
password manager): each one signs in once without the phone. From then on every sign-in asks for
the password and a code.

**Check:** after the second factor, the Overview opens (empty until an application is connected,
phase 9), the menu shows Applications, Retention, Integrity, Users and Invitations, and the header
says **Live** within a few seconds (the panel's live alerts reach it through Caddy; another proxy
in front must not buffer them: [deploy-vps.md](deploy-vps.md#how-it-works)).

**The other people** come by invitation, from the admin pages (email on, 7.6):

1. **Invitations**: their address and a role (Member or Admin). The person opens the link (valid
   for 7 days), chooses their name and password, and sets up their own authenticator app.
2. An auditor or a viewer: invite them as Member; once they accepted, **Users** → their page →
   **Role** (auditor or viewer), then the applications they see (after phase 9 registers them).
   Role and application changes ask for your password and a fresh code again when the last time
   was more than 5 minutes ago.
3. A second administrator (0.1): with only one, nobody can reset that administrator's second
   factor from the admin pages.

Without email, each account is created with the same `create-user` command
(`--role admin`, `auditor`, `viewer` or `member`), and sets up its second factor at its first
sign-in.

**Check:** **Users** lists everyone of 0.1 with their role; **Invitations** has none pending.

### 8.5 Rehearse a rollback (staging)

Staging runs `v<version>` (8.3) and keeps the build of 8.1 as the release before it: that one is what
a rollback puts back. On the staging server:

```
cd /srv/app
./rollback.sh
```

**Check:** it prints `rollback: running <commit of 8.1>`; https://staging.acme.com/app-config.json
shows that commit as `release`; the site still works.

Then bring staging back to the release through the workflow, as for any deployment:

```
gh workflow run deploy.yml --ref main -f environment=staging -f ref=v<version>
gh run watch
```

**Check:** the run ends green and `app-config.json` shows the commit of `v<version>` again. Rolling
back is now something you have done, not something you read about.

---

## Phase 9. Connect the first application

Audit Hub is running; now an application sends it its events. Start with the one chosen in 0.1 (a
test application, or the staging environment of a real one) and Audit Hub's staging; then the same
steps for production, as a new registration. The whole procedure, with every variable and the
flows to record: [audit/connection-guide.md](audit/connection-guide.md); in short:
[manual 11.9](manual.md#119-audit-hub-connecting-a-project).

### 9.1 Register the application

Signed in to Audit Hub as an administrator: **Applications → Register an application**, with its
name, slug and environment, and its webhook URL (optional: `https://<the project's host>/api/audit/webhooks`,
for alerts, "Was it you?" and response actions to reach it). It asks for your password and a fresh
code. The next page shows the application's variables **once** (`AUDIT_HUB_URL`, `AUDIT_HUB_APP`,
`AUDIT_HUB_KEY_ID`, `AUDIT_HUB_KEY_SECRET`, `AUDIT_HUB_PSEUDONYM_KEY`, `AUDIT_HUB_WEBHOOK_SECRET`):
copy them to the password manager before you leave it.

Then, if 0.1 said so: **Retention** → the application → the days of each class (never below the
minimums), and **Users** → each auditor or viewer → the applications they see.

**Check:** **Applications** lists it; `AUDIT_HUB_URL` is Audit Hub's own address (`APP_ORIGIN`,
7.6).

### 9.2 Install the connector in the project

A project created from the templates after their patches were applied has the connector already,
installed and off: go on at 9.3. Otherwise, from your Audit Hub checkout at a release tag, with the
project's dependencies installed:

```
pnpm connector add --target <project>
```

Then, in the project: `pnpm db:migrate`, the four wiring edits the command prints, and the flows to
record ([Integration points](audit/connection-guide.md#integration-points)). Commit
`audit-connector.json` and `.audit-connector/` with the rest, through the project's own pull
request.

**Check:** the project's `pnpm verify` passes; `pnpm connector status --target <project>` (from
Audit Hub) shows the installed version.

### 9.3 Turn it on

Set the variables of 9.1 in the project's environment (its secret store, or the `api.env` of its
server) and redeploy the project.

**Check**, in Audit Hub:

- within a minute, the **Overview** shows the application with its last heartbeat;
- sign in to the project (a wrong password counts too): **Events** shows the event;
- with a webhook URL: the application's page → **Webhooks** → **Send a test**, and the delivery
  below it shows `delivered`;
- the **SOC view** shows the application's source as **Active**. Stop the project: after its
  heartbeat timeout the source turns **Disconnected** and a `source_silent` alert opens (with a
  notice and, once you clicked the page, its sound); start it again and the alert resolves by
  itself.

**If it fails:** no heartbeat after a few minutes means the project cannot reach Audit Hub or is
refused: with the project's metrics on (OpenTelemetry), the connector's
`app_audit_hub_requests_total` says how its requests end (`refused`, `unreachable`...), and the
guide's
[Observability](audit/connection-guide.md#observability) lists its alerts. Check that all the
variables of 9.1 are set, with nothing cut off.

---

## Phase 10. Monitoring and alerts

### 10.1 Error reports (Sentry)

1. In Sentry, create two projects: **Node.js** (the API) and **Browser JavaScript** (the web app).
   Copy each project's DSN.
2. On each server, add `SENTRY_DSN=<API DSN>` to `api.env` and `WEB_SENTRY_DSN=<web DSN>` to
   `web.env`, then:

   ```
   cd /srv/app
   docker compose --env-file server.env --env-file release.env up -d --wait api web
   ```

**Check:** `https://app.acme.com/app-config.json` shows the web DSN; the API's log line
`Starting release … error tracking on` (`docker compose --env-file server.env --env-file release.env logs api | head`).
In Sentry, set alert rules: [alerting.md](alerting.md).

### 10.2 Uptime

In your uptime monitor, add two checks every minute from several regions:

- `https://app.acme.com/healthz` (the web server),
- `https://app.acme.com/app-config.json` (the app's configuration is served).

Send the alerts to the people of 0.1 (email and a phone notification).

**Check:** both checks show "up"; send the monitor's test notification and confirm that every
person on the list received it.

### 10.3 Logs

The containers' logs stay on the server (`docker compose … logs`), rotated: five files of 10 MB
per container. For more than one server, or
to search them, send them to a log service ([observability.md](observability.md)).

---

## Phase 11. Before real users

Go through [production-readiness.md](production-readiness.md) with the team and tick each line
with its evidence. The ones this guide has not covered yet:

1. **A restore drill** of the database: restore the latest backup into a new instance with your
   provider's tool and check the data ([disaster-recovery.md](disaster-recovery.md#checklist)).
   Write down how long it took.
2. **Alerts and SLOs** agreed ([alerting.md](alerting.md)).
3. **The contacts table** of [incident-response.md](incident-response.md) filled in.
4. **Legal** (phase 6): counsel has reviewed the documents of [privacy/](privacy/README.md); the
   processor contract is signed with each client (or, for your own company's applications,
   adopted as an internal policy); each connected application has added the paragraphs of
   [privacy-notice.md](privacy/privacy-notice.md) to its privacy notice; Audit Hub's own users
   have yours.
5. **The checkpoint digests** are kept outside Audit Hub (0.1): copy the last one (the
   **Integrity** page), or make one on the production server, in `/srv/app`:

   ```
   docker compose --env-file server.env --env-file release.env \
     run --rm -T api node dist/integrity/audit.cli.js checkpoint
   ```

   It prints `Checkpoint <id>: <digest>`; keep both, with the date, in the place 0.1 chose.

6. **Retention** set for each application whose contract or law asks for more than the minimums
   (**Retention** page; 0.1).
7. **A test application connected end to end** (phase 9): its heartbeat in the **Overview**, an
   event of it in **Events**.
8. **The alert channels tested.** The application's webhook: **Send a test** on its page
   ([manual 11.6](manual.md#116-audit-hub-alert-notifications-and-ip-geolocation)). Slack or Teams
   and the alert emails, with one real alert: ten wrong passwords for one account of the test
   application, within a few minutes, raise `brute_force_account` (high severity) at the rules'
   next run (every 5 minutes). It shows in **Alerts**, in the chat channel (medium severity and
   above) and in the administrators' email (high and above).
9. **The production approval** in GitHub has at least one reviewer who is not the author.

**Check:** the sign-off block at the end of production-readiness.md is filled in.

---

## Phase 12. The daily loop

Every change, the same way:

| Step                     | Do                                                                                                                                 | Check                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1. Start                 | `git switch main && git pull && pnpm install && pnpm db:migrate && pnpm dev`                                                       | the app runs locally             |
| 2. Branch                | `git switch -c feat/<short-description>` (or `fix/…`, `chore/…`)                                                                   | `git branch` shows it            |
| 3. Change                | code and tests together ([how-to.md](how-to.md)); a schema change: `pnpm db:migrate --name <name>`; an API change: `pnpm contract` | the app does what the issue asks |
| 4. Verify                | `pnpm verify` (and `pnpm test:integration` for API changes, `pnpm test:e2e` for user flows)                                        | all green                        |
| 5. Commit                | `git add -A && git commit -m "feat(<area>): <what>"`                                                                               | the hooks pass                   |
| 6. Push and pull request | `git push -u origin HEAD && gh pr create --fill`                                                                                   | **CI passed** green              |
| 7. Review                | a teammate reviews; answer every comment                                                                                           | approved                         |
| 8. Merge                 | **Squash and merge**                                                                                                               | the release pull request updates |
| 9. Release               | merge the release pull request when you want a version                                                                             | a tag `vX.Y.Z`                   |
| 10. Deploy               | Deploy the tag to staging, try it, then to production (approval)                                                                   | smoke test green on both         |
| 11. Watch                | Sentry and the uptime monitor during the next hour                                                                                 | no new errors                    |

If production misbehaves after a deployment: `./rollback.sh` on the server, then fix forward with a
new pull request ([deploy-vps.md](deploy-vps.md#roll-back)).

---

## Phase 13. The maintenance calendar

| When                          | Do                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every week                    | Approve Dependabot's update pull requests: patch and minor ones merge themselves once CI is green; majors and workflow updates you merge by hand.                                                                                                              |
| Every week                    | Read the DAST results (the **DAST** workflow runs on Mondays).                                                                                                                                                                                                 |
| Every month                   | On each server: `docker image prune`, and `docker image rm` the release images not named in `release.env` or `release.previous.env` (docs/deploy-vps.md#keep-the-server-healthy); reboot if `/var/run/reboot-required` exists.                                 |
| Every month                   | With IP geolocation: the new DB-IP files on each server ([deploy-vps.md](deploy-vps.md#ip-geolocation)).                                                                                                                                                       |
| As decided in 0.1             | Copy the last checkpoint digest (the **Integrity** page, or `audit.cli.js checkpoint` as in phase 11) to its place outside Audit Hub.                                                                                                                          |
| Every quarter                 | A database restore drill; review the alerts; check `RELEASE_PLEASE_TOKEN`'s expiration, if you set it; what Dependabot never proposes: a Node.js LTS major (each October), pnpm, PostgreSQL and Redis majors ([ci-cd.md](ci-cd.md#keeping-the-stack-current)). |
| When a secret may have leaked | Rotate it at once ([security.md](security.md#secret-rotation)).                                                                                                                                                                                                |
| After every incident          | A short postmortem; update the runbook and the alerts.                                                                                                                                                                                                         |

---

## When something is not in this guide

| Situation                                                     | Where                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| An error message                                              | [troubleshooting.md](troubleshooting.md) (search a few words of it)                                  |
| How something works                                           | [manual.md](manual.md)                                                                               |
| A kind of change (table, endpoint, screen, role…)             | [how-to.md](how-to.md)                                                                               |
| The server deployment in detail                               | [deploy-vps.md](deploy-vps.md)                                                                       |
| An incident                                                   | [incident-response.md](incident-response.md)                                                         |
| Connecting an application, its mobile app or its web app      | [audit/connection-guide.md](audit/connection-guide.md)                                               |
| A privacy request, someone leaving, the end of an application | [manual 11.10](manual.md#1110-audit-hub-privacy-requests-its-accounts-and-the-end-of-an-application) |
| The legal documents                                           | [privacy/README.md](privacy/README.md)                                                               |
