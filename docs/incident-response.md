# Incident response

How to run an incident with what the template already emits: health probes, structured logs with
request ids, the 5xx origin (`error.origin`), metrics and traces (OpenTelemetry, OPTIONAL), error
reports (Sentry, OPTIONAL). No incident-management platform is assumed; the alerts that start an
incident are in [alerting.md](alerting.md), restores in [disaster-recovery.md](disaster-recovery.md).

## Roles and contacts

REQUIERE CONFIGURACIÓN: fill this table in for the project and keep it current; an incident is the wrong time to look for
a phone number.

| Role                        | Who                                        | How to reach               |
| --------------------------- | ------------------------------------------ | -------------------------- |
| Service owner               | _team or person_                           | _channel_                  |
| Primary / secondary on-call | _rotation_                                 | _paging tool or phone_     |
| Incident commander (SEV1)   | _rotation or engineering lead_             | _channel_                  |
| Security contact            | the private contact of `SECURITY.md`       | _restricted channel_       |
| Database and platform owner | _team or provider_                         | _channel, provider ticket_ |
| External providers' support | _one line per provider (Sentry, cloud...)_ | _support URL, contract id_ |

**Severity:** SEV1 = outage, data loss or a security breach (CRITICAL alerts); SEV2 = a feature or
a share of users degraded (CRITICAL or persistent WARNING); SEV3 = minor, no user impact yet
(WARNING). The incident commander of a SEV1 coordinates and communicates; others fix.

## The first five minutes

1. **Acknowledge** the alert and open an incident record: time, who, the alert, the link to the
   dashboard. Every later step goes in it with its time.
2. **What changed?** The latest deployments (Deploy workflow runs; the `release` field of the log
   lines and `/app-config.json` say which commit is running), configuration or secret changes,
   migrations, provider maintenance.
3. **How big?** Readiness of each instance, the 5xx rate by `error.origin` and `http.route`, uptime
   checks, Sentry's users per issue.
4. **Roll back first** when the start matches a deployment: redeploy the previous image digests
   ([9. Failed deployment](#9-failed-deployment)); the root cause can wait for a stable system.
5. **Communicate:** who is on it, what users see, when the next update comes.

## Where to look

| Question                      | Look at                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Is an instance ready?         | `curl http://<api>:3000/api/health/ready` from inside the platform (the public URL answers 404 for probes)                                 |
| Is the public side up?        | `pnpm smoke --url <public URL>` (read-only; add `--api <API URL>` from inside the platform)                                                |
| What happened to one request? | The `X-Request-Id` the client got: the log lines with that `requestId`, its Sentry report (`request_id` tag), its trace (`app.request_id`) |
| Where do the 5xx come from?   | `app_server_errors_total` by `error_origin` and `http_route`; the error line `METHOD /path -> 5xx (request <id>, <origin>)`                |
| Which version is running?     | `release` on the log lines and spans (`service.version`), `release` in `/app-config.json` for the web image                                |
| Is the database the problem?  | Readiness `Database unreachable`, `error.origin=database`, `db_client_connection_*` pool metrics, `Slow query` warnings                    |
| Is Redis the problem?         | Readiness `checks.redis`, `Redis unavailable`, `Redis is not answering` and the matching recovery lines, `app_degraded_operations_total`   |
| The overall picture?          | Grafana → Application: "API service" (traffic, errors by origin, runtime, database, Redis, dependencies), "API SLOs" (budget, burn rates)  |
| Do pages feel slow?           | Grafana → Application → "Web Vitals": LCP, INP, CLS, FCP and TTFB at p75 per page, from real page loads                                    |
| Is a provider the problem?    | `app_dependency_duration_seconds` by `dependency_name` and `outcome`, `External:<name>` log lines, the provider's status page              |

PromQL for each metric: docs/observability.md#metrics. Log patterns: [alerting.md](alerting.md#log-patterns).

## Runbooks

Each runbook: the alerts that open it, symptoms, impact, first checks, signals, immediate actions,
mitigation, when to roll back, when it is recovered, what to validate afterwards, what to document.
The alerts are the rules of `observability/prometheus/rules`, whose `runbook_url` points at these
sections and whose `dashboard_uid` names the dashboard to open first
([observability.md](observability.md#alerts)). The general rule for rollback: if the problem
started with a deployment, roll back first and investigate after.

### 1. API down

- **Alerts:** `ApiMetricsAbsent` (no metrics at all); the external uptime checks.
- **Symptoms:** the uptime check on a page that calls the API fails; `/api/*` answers nginx's 502
  or 504 while `/healthz` (nginx alone) still answers 200; no access log lines from the API.
- **Impact:** total for signed-in use: the app shell loads, every API call fails, nobody can sign in.
- **First checks:** are the API containers running or restarting (platform events, exit codes)?
  The last lines of an instance: an `Environment variable X is invalid` line at boot means a
  configuration change; `fatal` lines mean a crash ([8](#8-repeated-application-crashes)); exit
  code 137 means killed for memory ([7](#7-memory-or-cpu-pressure)). The nginx error log:
  `connect() failed` or `could not be resolved` for the API upstream.
- **Signals:** container restarts; `level=fatal`; the boot line `Starting release <sha> in <env>`;
  no `http_server_request_duration_seconds` samples at all.
- **Immediate actions:** a deployment or configuration change in the last hour: roll it back
  (redeploy the previous digests, restore the previous variable). Otherwise follow the cause above.
- **Mitigation:** add capacity if instances are killed for memory or CPU; check that `API_UPSTREAM`
  resolves from the web container (nginx looks it up again every 10 seconds).
- **Roll back when:** it started within the window of a deployment or configuration change.
- **Recovered when:** every instance is ready, the smoke test passes, the 5xx rate is back to its
  baseline for 15 minutes.
- **Validate after:** `pnpm smoke --url <public URL> --api <API URL>`; sign in with a test
  account; the uptime checks are green from every location.
- **Document:** time of first failure, of detection and of recovery; the trigger; why no earlier
  alert fired, if none did.

### 2. Readiness failing

- **Alerts:** `ApiReadinessFailing`.
- **Symptoms:** instances marked unready, taken out of the load balancer; `GET /api/health/ready`
  answers 503 with the reason in the message: `Database unreachable`, `Redis unreachable` (only
  with `REDIS_REQUIRED=true`) or `Shutting down`. `status: "degraded"` with 200 is not a failure.
- **Impact:** some instances: less capacity, higher latency. All instances: an outage.
- **First checks:** the message decides: database → [3](#3-database-unavailable); Redis →
  [4](#4-redis-unavailable); `Shutting down` outside a deployment → something sends SIGTERM
  (autoscaling, node drain: platform events). A probe that times out instead of answering points
  at a blocked event loop or CPU starvation ([7](#7-memory-or-cpu-pressure)): readiness answers
  within 2.5 seconds whatever its dependencies do, so give the probe a timeout of 3 seconds or
  more.
- **Signals:** the warning `Readiness: database unreachable (<driver message>)` or
  `Readiness: Redis unreachable (REDIS_REQUIRED=true)`; ready instance count.
- **Immediate actions:** do not restart instances in a loop: liveness still answers 200 on
  purpose, and a restart does not fix a dependency. Fix the dependency.
- **Mitigation:** if a new hard dependency came with a deployment, roll back.
- **Roll back when:** the failure started with a deployment.
- **Recovered when:** every instance is ready for 10 minutes.
- **Validate after:** readiness on each instance; the smoke test.
- **Document:** which dependency, how long, how many instances.

### 3. Database unavailable

- **Alerts:** `ApiDatabaseErrors`; often `ApiReadinessFailing` with it.
- **Symptoms:** readiness 503 `Database unreachable`; 5xx lines ending `, database)`;
  `app_server_errors_total{error_origin="database"}` rising; Sentry issues with `error.origin:
database`; failing pg spans. The API keeps running (it even starts without a database, and
  says so: `Database unreachable at boot`), so this is not a crash loop.
- **Impact:** everything but the web shell fails. Signed-in users keep their refresh cookie: a
  failed refresh on a server error does not sign anyone out (docs/security.md).
- **First checks:** the driver's message in the readiness warning: `ECONNREFUSED` or a timeout
  (down, failover, network), `too many clients already` (connection limit),
  `password authentication failed` (rotated credentials), an SSL error (TLS settings), `the
database system is in recovery mode` (restart or failover). The provider's status, maintenance
  and failover events; storage free space.
- **Signals:** `db_client_connection_count` by state, `db_client_connection_pending_requests`;
  the provider's CPU, connections, storage and replication metrics.
- **Immediate actions:** a failover in progress: wait; the pool reconnects on its own. Connection
  limit reached: the instances × `DB_POOL_MAX` must fit in the database's limit
  (docs/database.md#connections); look for idle or stuck sessions in `pg_stat_activity` and end
  them (`pg_terminate_backend`). A migration holding a lock: cancel it ([10](#10-failed-database-migration)).
- **Mitigation:** scale the database, free storage, restore the previous credentials or rotate
  them everywhere at once. Data lost: [disaster-recovery.md](disaster-recovery.md).
- **Roll back when:** a deployment changed `DATABASE_URL`, `DB_POOL_MAX` or ran a migration just
  before.
- **Recovered when:** readiness 200 everywhere, no `database` errors for 15 minutes, no pending
  pool requests.
- **Validate after:** the smoke test; the data written just before the outage is there (requests
  that failed were rolled back and answered 5xx with a request id).
- **Document:** cause, duration, number of failed requests, whether data was lost.

### 4. Redis unavailable

- **Alerts:** `ApiDegradedMode` (`feature`, `dependency_name` labels).
- **Symptoms:** `Redis unavailable (<host>): <reason>` once per outage, or
  `Redis is not answering (<host>)` when it stays connected but stops replying; readiness
  `status: "degraded"`, `checks.redis: "unavailable"` (200); `Rate limiting falls back to
per-instance counters`; `Cache unavailable, serving from the source`;
  `app_degraded_operations_total` rising. With `REDIS_REQUIRED=true`: readiness 503
  `Redis unreachable`.
- **Impact:** degraded, not down: rate limits count per instance (more permissive by the number of
  instances), every cache read goes to the database (more database load), locks and idempotency
  claims fail closed (503 `Service temporarily unavailable, retry later`, logged
  `dependency: redis`): jobs skip their run, webhook deliveries are refused and retried by their
  sender. Redis holds nothing that must survive (docs/disaster-recovery.md#what-to-protect).
- **First checks:** the reason in the line: `ECONNREFUSED` or a timeout (down, network), `WRONGPASS`
  or `NOAUTH` (credentials changed), `LOADING` (Redis restarting and loading its data, transient),
  `OOM command not allowed` (memory full). The provider's status and memory metrics.
- **Signals:** node-redis command metrics (errors, duration), database latency (cache misses).
- **Immediate actions:** none needed in the application: it reconnects by itself (backoff up to
  5 seconds). Watch database load and latency while the cache is out.
- **Mitigation:** restart or fail over Redis; restore the credentials; memory full: every key the
  template writes has a TTL, so check the eviction policy and what else writes to that Redis.
- **Roll back when:** a deployment changed `REDIS_URL` or the stores.
- **Recovered when:** `Redis connection restored after <n>s` or `Redis answering again after <n>s`,
  `Rate limiting uses the shared Redis counters again`, `Cache available again`; readiness `ok` on
  every instance.
- **Validate after:** `app_degraded_operations_total` stops increasing; work skipped by locks ran
  on its next schedule.
- **Document:** duration, what was refused while it failed closed, database load during the outage.

### 5. High 5xx rate

- **Alerts:** `ApiAvailabilityBudgetFastBurn` (CRITICAL), `ApiAvailabilityBudgetSlowBurn`,
  `ApiRouteErrorRatioHigh` (one route).
- **Symptoms:** availability burn rate alert; Sentry spike; 5xx lines
  `METHOD /path -> 5xx (request <id>, <origin>)`.
- **Impact:** the routes affected, for every user who calls them.
- **First checks:** split `app_server_errors_total` by `error_origin`, `http_route` and the
  release (`service.version`): `application` is a bug, usually of the latest release;
  `database` → [3](#3-database-unavailable); `dependency: <name>` →
  [12](#12-external-dependency-outage) (`dependency: redis` → [4](#4-redis-unavailable));
  `unavailable` is a deliberate 503 (readiness, shutdown). 502 or 504 from nginx without an API
  line → [1](#1-api-down) or [6](#6-high-latency).
- **Signals:** the stack trace in the error line or the Sentry issue; the trace of a failing
  request (`app.request_id`).
- **Immediate actions:** errors from the new release: roll back.
- **Mitigation:** a hotfix through the normal pipeline when a rollback is impossible (a contract
  the clients already use).
- **Roll back when:** the errors started with a deployment and belong to the new release.
- **Recovered when:** the burn rate is below 1 for 30 minutes.
- **Validate after:** the Sentry issue has no events in the fixed release; the smoke test.
- **Document:** budget spent (alerting.md#error-budget), root cause, the test that now covers it.

### 6. High latency

- **Alerts:** `ApiLatencyBudgetFastBurn` (CRITICAL), `ApiLatencyBudgetSlowBurn`,
  `ApiRouteLatencyHigh` (one route), `ApiDatabasePoolSaturated`.
- **Symptoms:** p95 or p99 of `http.server.request.duration` above the latency SLO, latency burn
  rate alert, users reporting slowness; nginx's access log `request_time`.
- **Impact:** slow pages, client timeouts, retries that add load.
- **First checks:** which routes (`http_route`); the database (`db.client.operation.duration`,
  `Slow query (<n> ms): <statement>` warnings, `db_client_connection_pending_requests` above zero
  means the pool is exhausted); dependencies (`app_dependency_duration_seconds` p95 per
  dependency); the event loop (`nodejs.eventloop.delay.p99`), CPU throttling; Redis down (cache
  misses, [4](#4-redis-unavailable)). A slow trace shows which span takes the time.
- **Immediate actions:** a deployment correlates: roll back. CPU-bound instances: add instances,
  if the database has connections to spare (instances × `DB_POOL_MAX`).
- **Mitigation:** the index a slow statement needs (`EXPLAIN ANALYZE` on a copy); cancel runaway
  queries (`pg_stat_activity`, `pg_cancel_backend`); raise `DB_POOL_MAX` only when the pool wait
  is the bottleneck and the database has headroom.
- **Roll back when:** the slowdown started with a deployment.
- **Recovered when:** p95 and p99 below the threshold for 30 minutes.
- **Validate after:** no pending pool requests; slow query count back to normal.
- **Document:** the slow component, the fix, the load at the time (for capacity planning,
  [load-testing.md](load-testing.md)).

### 7. Memory or CPU pressure

- **Alerts:** `ApiEventLoopDelayHigh`.
- **Symptoms:** CPU near the container's limit or throttled; `process.memory.usage` (RSS) or
  `v8js.memory.heap.used` growing toward the memory limit; longer `v8js.gc.duration`; event loop
  delay; restarts with exit code 137 (killed for memory).
- **Impact:** latency first, then restarts and failed requests.
- **First checks:** traffic grew (load), traffic is flat but memory climbs (a leak: a sawtooth that
  resets at each restart), or it started with a release (a regression). One instance or all?
- **Immediate actions:** release-related: roll back. Load: add instances (check the database
  connection budget) or raise the limits.
- **Mitigation:** for a leak, a rolling restart buys time; it is not a fix. Take a heap snapshot
  of one instance outside peak hours (Node.js `--heapsnapshot-signal` through `NODE_OPTIONS`) and
  compare two snapshots.
- **Roll back when:** it started with a deployment.
- **Recovered when:** below the warning thresholds for an hour without a restart.
- **Validate after:** memory flat over a full traffic cycle.
- **Document:** growth rate, the culprit, whether limits or capacity planning must change.

### 8. Repeated application crashes

- **Symptoms:** instances restarting in a loop; `fatal` lines `uncaughtException: <stack>` or
  `unhandledRejection: <stack>` (the process exits on purpose after logging and reporting them);
  Sentry events with level fatal and `error.origin: process`.
- **Impact:** from lost requests to an outage, depending on how many instances crash.
- **First checks:** the stack in the `fatal` line; whether the crash follows a specific request
  (the lines just before it, the same route each time: a "poison" request); the boot line and any
  `Environment variable X is invalid` line (a configuration change stops the boot, by design); exit
  code 137 → [7](#7-memory-or-cpu-pressure).
- **Immediate actions:** roll back the release or the configuration change. A poison request from
  outside: block it at the edge (WAF rule, path or client) until the fix ships.
- **Mitigation:** the fix with a test that reproduces the crash.
- **Roll back when:** crashes started with a deployment or configuration change.
- **Recovered when:** no restart for 30 minutes and no new `fatal` line.
- **Validate after:** the smoke test; the poison request, if any, now answers a 4xx or 5xx without
  a crash.
- **Document:** the stack, the trigger, why it was not caught by tests.

### 9. Failed deployment

- **Symptoms:** the Deploy workflow failed at a step (gates, image push, migration, rollout, smoke
  test), or alerts fired right after a rollout.
- **Impact:** none if it failed before the rollout (the running version is untouched); otherwise
  old and new versions may be serving side by side.
- **First checks:** which step. Before the migration: nothing changed in the environment, fix and
  run again. Migration → [10](#10-failed-database-migration). Rollout or smoke test: which
  `release` each instance runs.
- **Immediate actions:** rollout or smoke test failed: redeploy the image digests recorded before
  the deployment (docs/ci-cd.md#rollback). That is faster and safer than running Deploy with the
  previous tag: Deploy re-runs every gate, and an advisory published since then could block it.
- **Mitigation:** fix forward through a new pull request once the previous version serves.
- **Roll back when:** the smoke test failed, or errors or latency rose after the rollout. Do not
  fix forward under a live incident unless a rollback is impossible.
- **Recovered when:** one version serves everywhere and the smoke test passes with its `--release`.
- **Validate after:** `pnpm smoke --url <public URL> --api <API URL> --release <sha>`; error rate
  and latency at their baseline.
- **Document:** the failing step, the rollback time, what the gates missed.

### 10. Failed database migration

- **Symptoms:** the `api-migrate` job exits with `Error: P3018 A migration failed to apply` and the
  database error; later runs fail with `P3009 migrate found failed migrations`; or the job hangs on
  a lock and the deployment times out. Two more stop it before any statement runs:
  `P1002 ... Timed out trying to acquire a postgres advisory lock` (another migration run holds the
  database: wait for it, then deploy again) and
  `Migrations changed after they were applied to this database: <names>` (below).
- **Impact:** the deployment stops before the rollout, so the running version keeps serving.
  **Prisma does not wrap a migration in a transaction on PostgreSQL:** the statements before the
  failing one stay applied (verified with Prisma 7 on PostgreSQL 18). An expand migration leaves an
  extra table or column the running version ignores; a destructive statement can break it.
- **First checks:** which migration and which statement:
  `docker run --rm -e DATABASE_URL=<url> <api-migrate image>@<digest> node node_modules/prisma/build/index.js migrate status`.
  Compare the migration's statements with the database (`\d <table>` in `psql`) to see which ones
  took effect. Is the running version healthy?
- **Immediate actions:** do not roll out the new version. Never run `migrate dev` or `migrate reset`
  against the environment, and never edit `_prisma_migrations` by hand.
- **Mitigation**, in the database, then with the same image and `migrate resolve`:
  - the migration is right but the data was not ready (a `NOT NULL` on rows with nulls, a
    duplicate under a new unique index): undo the statements that took effect, fix the data, mark
    it rolled back (`migrate resolve --rolled-back <migration>`), and deploy the same release again;
  - the migration is wrong: undo what took effect, mark it rolled back, and ship a corrected
    migration in a new pull request (editing the failed file is acceptable only if it has not been
    applied in any environment);
  - finishing it by hand is the last resort: apply the remaining statements, then
    `migrate resolve --applied <migration>`;
  - `Migrations changed after they were applied to this database`: nothing ran; a migration
    applied here was edited since (docs/database.md#migrations). Put the file back as it was
    applied (`git log -p -- apps/api/prisma/migrations/<name>/migration.sql` shows its versions),
    ship the change as a new migration, and deploy again. Never update the checksum in
    `_prisma_migrations` to get past it: this database would keep a schema the new code does not
    expect.
- **Roll back when:** the partial migration broke the running version: repair the schema by hand
  first; if data was destroyed, restore ([disaster-recovery.md](disaster-recovery.md)).
- **Recovered when:** `migrate status` says `Database schema is up to date!` and the deployment
  completed.
- **Validate after:** the smoke test; the tables the migration touched hold what they should.
- **Document:** the statement, why the rehearsal did not catch it.
- **Prevention** (docs/database.md#migrations): small migrations, `SET lock_timeout` at their top,
  and a rehearsal against a restored copy of production before releasing anything that rewrites
  data or locks large tables.

### 11. Authentication or security attack

- **Symptoms:** `Refresh token reuse for user <id> (at refresh|logout)` (a stolen refresh token
  was replayed: that session family is already revoked); bursts of 401 and 429 on
  `/api/auth/sign-in` (credential stuffing, from one address or many); bursts of 403
  `Cross-origin request refused` (forged cross-site requests); reports through `SECURITY.md`; a
  leaked secret.
- **Impact:** account takeover, data exposure, or availability (floods).
- **First checks:** one user or many; the `ip` field of the access log (all requests from the
  proxy's address means `TRUST_PROXY` is wrong, and then the rate limit throttles everyone
  together); which secret could be exposed and since when.
- **Immediate actions:**
  - stolen session: the family is revoked automatically; to end every session of a user, revoke
    their rows under the user's row lock, the way the API changes sessions (a refresh in flight
    would otherwise commit a new token after a plain `UPDATE`, and that token keeps working):

    ```sql
    BEGIN;
    SELECT id FROM users WHERE id = '<id>' FOR UPDATE;
    UPDATE sessions SET revoked_at = now() WHERE user_id = '<id>' AND revoked_at IS NULL;
    COMMIT;
    ```

    Their access tokens still work until they expire, within 15 minutes;

  - credential stuffing: block at the edge (WAF, IP reputation); with several API instances, the
    shared rate limit store (`RATE_LIMIT_STORE=redis`) makes the per-IP limit hold across them;
  - leaked `JWT_ACCESS_SECRET`: rotate it without a previous value (docs/security.md#secret-rotation):
    every access token is refused at once; leaked database or Redis credentials: rotate them.
- **Mitigation:** fix the weakness; per-account limits, MFA or CAPTCHA if credential stuffing
  persists (docs/security.md#known-limits).
- **Roll back when:** a deployment introduced the weakness.
- **Recovered when:** the signals are back to their baseline and every exposed secret is rotated.
- **Validate after:** the old secret no longer works; affected users are signed out.
- **Document:** indicators, affected accounts and data, every action with its time. **Preserve
  evidence first**: export the relevant logs before their retention expires; do not redeploy over
  a compromised host before capturing it. Personal data breaches can carry legal deadlines for
  notification (REQUIERE CONFIGURACIÓN: who decides and how fast).

### 12. External dependency outage

- **Alerts:** `ApiDependencyFailing` (`dependency_name` label).
- **Symptoms:** 502 (`An upstream service failed`) or 504 (`An upstream service did not answer in
time`) on the routes that call a provider; 5xx lines ending `dependency: <name>)`; warnings from
  the `External:<name>` logger (`METHOD /path <status|timeout|network_error> <ms>ms attempts=<n>`);
  `app_dependency_duration_seconds_count{outcome!="success"}` per `dependency_name`.
- **Impact:** the features that need the provider; everything else works.
- **First checks:** the provider's status page; one provider or all (all: egress, DNS or proxy on
  our side); 401 or 403 from the provider means our credentials expired or were revoked; 429 means
  we exceed its quota (the client honors `Retry-After`).
- **Immediate actions:** none in the application (no restart helps); tell users what does not work.
- **Mitigation:** rotate expired credentials; contact the provider's support (contacts table);
  disable or queue the feature if the outage lasts (project-specific).
- **Roll back when:** a deployment changed the integration.
- **Recovered when:** the success ratio of that dependency is back to its baseline.
- **Validate after:** a real call through the feature.
- **Document:** provider, duration, failed operations to replay, whether timeouts and retries
  behaved (docs/observability.md#external-services).

### 13. Sentry critical error spike

- **Symptoms:** Sentry alert: a new issue in production, a regression, an issue's frequency jump.
- **Impact:** read it from the issue: users affected, routes (`http.route`), release.
- **First checks:** the release where it was first seen; `error.origin`; the `request_id` tag →
  the log line with the stack → the trace. Compare with the 5xx metrics: Sentry samples
  (`SENTRY_SAMPLE_RATE`) and can drop events at its quota, the metrics do not.
- **Immediate actions:** new in the latest release and user-facing: roll back. Otherwise fix
  forward with priority.
- **Mitigation:** without Sentry (not configured), the same information is in the error log lines.
- **Roll back when:** it is new in the release just deployed and affects a critical flow.
- **Recovered when:** no new events in the fixed release for 24 hours; the issue resolved.
- **Validate after:** the regression test that reproduces it passes.
- **Document:** the issue link, its cause, why tests missed it.

### 14. Data corruption or suspected data loss

- **Symptoms:** users report missing or wrong data; a migration, backfill, job or manual query
  wrote what it should not; PostgreSQL reports `invalid page in block` or `could not read block`
  (physical corruption).
- **Impact:** potentially permanent; possibly a personal data incident.
- **First checks:** who is writing the bad data (a release, a route, a job, a migration, a
  person) and since when: logs by route and release, `created_at` and `updated_at` of the damaged
  rows.
- **Immediate actions:** stop the writer: roll back the release, disable the job, revoke the
  operator's access. Freeze deployments. **Take a backup or snapshot of the current state now**:
  it is the evidence and it holds the good data written since the damage. Never repair production
  with a script that was not run on a copy first.
- **Mitigation:** restore a copy at the moment just before the first bad write into a separate
  database ([disaster-recovery.md](disaster-recovery.md#restore-procedure)), then repair: copy
  back only the damaged rows when the damage is identifiable (keeps everything written since);
  restore the whole database to that point only when the damage is widespread and the product
  owner accepts losing the writes since then.
- **Roll back when:** a release or job is the writer (immediately).
- **Recovered when:** the data is verified by its owners and the writer is fixed.
- **Validate after:** the checks of disaster-recovery.md#restore-testing on the repaired tables.
- **Document:** affected records and users, the window of lost or wrong data, the notification
  decision (REQUIERE CONFIGURACIÓN: data protection obligations).

### 15. Poor Web Vitals

- **Alerts:** `WebVitalsLcpPoor`, `WebVitalsInpPoor`, `WebVitalsClsPoor` (`page_route` label).
- **Symptoms:** a page's p75 above "good" for 30 minutes: LCP above 2.5 s (the main content
  appears late), INP above 200 ms (clicks and typing respond late), CLS above 0.1 (the layout
  jumps); users reporting a slow or jumpy page.
- **Impact:** slower, less usable pages for a quarter or more of their visits, and lower search
  ranking if it lasts; nothing is down.
- **First checks:** on the "Web Vitals" dashboard, which pages and since when; whether it started
  with a release (`release` in `/app-config.json`); the navigation types (a cold `navigate` versus
  `back-forward-cache`); LCP together with TTFB and FCP: a high TTFB is the server or the network
  (the API's latency on the "API service" dashboard, nginx), a high FCP with a normal TTFB is
  render-blocking JavaScript or CSS (`pnpm perf:check`, the bundle budget), a late LCP alone is
  the page's main content (an API call it waits for, a large image).
- **Immediate actions:** none urgent. If it started with a release and is severe, roll back.
- **Mitigation:** INP: long tasks in event handlers (split the work, defer what is not visible);
  CLS: give images and late content a reserved size, avoid inserting content above what is shown;
  LCP: make the main content's API call faster or earlier, lazy-load what is below it.
- **Roll back when:** a release caused it and the page is critical (sign-in, the main flow).
- **Recovered when:** the page's p75 is back under "good" for an hour of normal traffic.
- **Validate after:** the page's p75 on the dashboard over the next day; Lighthouse or the browser's
  performance panel on the page for the cause.
- **Document:** the page, the metric, the cause, the release, and a budget or test that would have
  caught it.

### 16. Email not delivered

- **Alerts:** `ApiMailBacklog` (messages wait more than 15 minutes), `ApiMailDeliveryFailed`
  (`mail_kind` label: messages given up on).
- **Symptoms:** users do not receive password resets or confirmations; readiness
  `checks.mail: "degraded"` (200, the instance still serves); in the log
  `Could not send <kind> message <id> (attempt n): <category>; retrying in <s> s`,
  `Gave up on <kind> message <id>: <category>`, or `Mail worker paused: <reason>` (the database);
  `app_mail_outbox_oldest_age_seconds` rising, `app_mail_deliveries_total{outcome="retry"}` rising
  without `outcome="sent"`. A refused configuration also reaches the error tracker as
  `SMTP refused the configuration (<category>)` (`dependency: smtp`).
- **Impact:** degraded, not down: nothing is lost, the outbox keeps every message
  (docs/architecture.md#email) and retries with backoff, but links arrive late, and a message
  that waits longer than its kind's validity (30 minutes for a password reset) is dropped unsent
  (`expired`): the person asks again once email works. Sign-in and every other feature work.
- **First checks:** `pnpm --filter api mail status` (in a deployment:
  `docker compose ... run --rm -T api node dist/infrastructure/mail/mail.cli.js status`): counts
  by status and kind, the age of the oldest waiting message, the latest failures and their
  category. The category says where to look: `connection`, `timeout`, `dns` (the server or the
  network), `auth`, `smtp_5xx_535` (credentials refused: rotated, expired, wrong
  `MAIL_SMTP_URL`), `tls` (the server does not offer STARTTLS, which production requires),
  `smtp_4xx_*` (the provider defers: rate limits, a sending quota), `smtp_5xx_*` (the provider
  refuses this message: a bad address, the sender's domain not verified, a suppression list).
  The provider's status page and its own logs for the same minutes.
- **Signals:** `app_mail_outbox_waiting`, `app_mail_outbox_oldest_age_seconds`,
  `app_mail_deliveries_total` by `outcome`, `app_mail_delivery_duration_seconds` (a slow server),
  `app_mail_suppressed_total` (per-address limits: one address asked repeatedly).
- **Immediate actions:** none needed for a transient outage: every instance retries on its own
  (30 s, then doubling to an hour, with jitter). If no message moves at all, check that an API
  instance runs: the workers live in the API.
- **Mitigation:** credentials: rotate them at the provider and update `MAIL_SMTP_URL`
  (percent-encode the password; docs/environment.md), then redeploy; waiting messages go out with
  their next attempt. A sender refused for domain authentication: fix SPF, DKIM and DMARC at the
  DNS. A provider down for long: switch `MAIL_SMTP_URL` to a second provider. Messages given up
  on (`failed`): once the cause is fixed, `mail retry --failed` (or `--id <id>`, `--kind <kind>`)
  queues them again; their address is kept for 7 days, after which they cannot be retried.
- **Roll back when:** a deployment changed `MAIL_SMTP_URL`, `MAIL_FROM` or `APP_ORIGIN`.
- **Recovered when:** `Sent <kind> message <id>` lines again; readiness `checks.mail: "ok"`;
  `app_mail_outbox_oldest_age_seconds` back under a minute; `mail status` shows nothing waiting
  for long.
- **Validate after:** `pnpm --filter api mail test --to <your address>` delivers; no new
  `failed` messages. Delivery is at least once: a worker that died after the server accepted a
  message and before recording it sends it again when its lease ends (2 minutes), so a few people
  may get a duplicate (with the same `Message-ID`); nothing to do about it.
- **Document:** duration, the category, how many messages were delayed, dropped (`expired`) or
  retried by hand, and what would have told you sooner.

### 17. Connected application silent or behind

- **Alerts:** `AuditHubAppSilent` (no heartbeat for 5 minutes), `AuditHubConnectorBacklog` (the
  oldest event in the connector's queue older than 15 minutes); the `connected_app` label names
  the application.
- **Symptoms:** the application's row in Audit Hub's connected applications page shows an old last
  heartbeat or a growing queue; `app_connected_app_heartbeat_age_seconds` or
  `app_connected_app_queue_oldest_age_seconds` rising; in the application's own logs (context
  `AuditForwarder`): `Audit Hub refused the events with <status>` (credentials or contract),
  `Audit Hub answered the events with <status>`, `Audit Hub unreachable (<kind>)`,
  `Audit queue backed up`.
- **Impact:** nothing is lost while the connector's queue holds (an outbox table in the
  application's database), but Audit Hub sees the events late: its alerts, its integrity seals and
  the auditors' searches miss them until they arrive.
- **First checks:** is the application up (its own health and uptime)? Does Audit Hub answer its
  requests: `app_ingest_requests_total{connected_app="<slug>"}` by `outcome` (`unauthorized`: a
  wrong or revoked key, runbook 19; `rate_limited`: its quota; nothing at all: it cannot reach
  Audit Hub)? Was the application deployed without its `AUDIT_HUB_*` variables (the connector is
  then off and sends no heartbeat)? Is Audit Hub itself healthy (runbook 1)?
- **Signals:** `app_connected_app_heartbeat_age_seconds`, `app_connected_app_queue_size`,
  `app_connected_app_queue_oldest_age_seconds`, `app_ingest_requests_total` by `outcome`; the
  application's `app_audit_outbox_*` metrics (its own `ApiAuditBacklog` alert).
- **Immediate actions:** none while the queue holds; tell the application's owner.
- **Mitigation:** network or DNS between the application and Audit Hub: fix it; the connector
  resends on its own, with backoff. Keys: runbook 19. Quota: raise the application's
  `rate_limit_per_minute` in its settings, or `RATE_LIMIT_MAX` when many applications share an
  egress IP. Connector off: set its variables and redeploy the application.
- **Roll back when:** a deployment of the application or of Audit Hub started it.
- **Recovered when:** heartbeats every minute again and the queue drains:
  `app_connected_app_queue_oldest_age_seconds` back under a minute.

### 18. Events missing from a connected application

- **Alerts:** `AuditHubSequenceGap` (sequence numbers missing for more than 10 minutes).
- **Symptoms:** the connected applications page shows open gaps; Audit Hub's log:
  `Sequence gap in application <id>: <from>–<to> of epoch <epoch>`.
- **Impact:** the audit trail of that application has a hole. Every event Audit Hub refused or
  saw twice still consumed its number (docs/adr/0005), so a gap means events that never arrived:
  lost at the origin (rows removed from the connector's queue by hand, a database restored to an
  earlier point) or suppressed on purpose. Treat it as a security event until explained.
- **First checks:** the gap's range and epoch (connected applications page, or
  `SELECT * FROM sequence_gaps WHERE closed_at IS NULL`); the application's heartbeat
  (`lastAssignedSeq` beyond the gap means the numbers were assigned there); its queue (events still
  waiting close the gap when they arrive); a restore or a reset of the application's database in
  the same hours (a new `sequenceEpoch` then appears and waits for acknowledgement).
- **Signals:** `app_ingest_sequence_gap_events`, `app_connected_app_queue_size`,
  `app_ingest_events_total{outcome="rejected", reason="sequence_conflict"}` (numbers reused: a
  restore).
- **Immediate actions:** tell the application's owner and the security contact; keep the
  application's database and logs (they may show who deleted what).
- **Mitigation:** events still queued: let them arrive. A restore: acknowledge the new epoch in
  the connected applications page (the old gap is recorded and closed as acknowledged, with your
  name). A deletion at the origin: an incident of the application, investigated there; close the
  gap as acknowledged only with the incident's reference.
- **Roll back when:** never; a gap is never closed by changing Audit Hub.
- **Recovered when:** no open gap past the grace period; every acknowledged gap has its reason.

### 19. Ingestion refusing events or signatures

- **Alerts:** `AuditHubIngestRejections` (over 5 % of an application's events refused for 15
  minutes), `AuditHubSignatureFailures` (signed requests refused for 10 minutes).
- **Symptoms:** `app_ingest_events_total{outcome="rejected"}` by `reason`;
  `app_ingest_requests_total` with `unauthorized`, `replayed` or `timestamp_skew`; Audit Hub's log:
  `Replayed request refused (key <id>, application <slug>)`; in the application's connector log,
  the reasons Audit Hub answered.
- **Impact:** refused events are kept only as bookkeeping (`ingest_exceptions`: their number,
  reason and paths, never their content): their content is lost unless the connector still holds
  them (retryable reasons). Refused signatures stop everything the application sends.
- **First checks:** by `reason`: `action_unknown` or `details_invalid` (the application records
  actions its published catalog does not describe: a deployment that did not publish its catalog,
  or a catalog out of date); `category_mismatch` (an action changed category without a new
  catalog); `source_not_allowed` (a device declared an action only the server may record: a client
  bug, or someone forging client events); `sequence_conflict` (runbook 18). For signatures:
  `timestamp_skew` (the application's clock: NTP), `unauthorized` with `connected_app="unknown"`
  (a key id Audit Hub does not know: a deleted or mistyped key, or scanning), `replayed` (the same
  nonce twice: a proxy retrying, or a replay attack).
- **Signals:** `app_ingest_events_total` by `reason`, `app_ingest_requests_total` by `outcome`, the
  per-application rows of `ingest_exceptions`.
- **Immediate actions:** a burst of `unauthorized` or `replayed` from addresses that are not the
  application's: the security contact (runbook 11); failing IPs get 429 after 30 failures a
  minute.
- **Mitigation:** catalog: publish it (the connector does at boot; check the application's
  `AUDIT_HUB_*` variables and its catalog file), then the connector resends the retryable events.
  Keys: rotate the application's key in Audit Hub and redeploy it with the new variables (the
  previous key keeps working for 7 days); revoke a key that leaked. Clock: fix NTP on the
  application's hosts.
- **Roll back when:** a deployment of the application changed its catalog or its connector.
- **Recovered when:** refusals back to their usual near-zero rate; signatures accepted.

### 20. Audit log integrity verification failed

- **Alerts:** `AuditHubIntegrityCheckFailed` (critical: a verification failed in the last 24
  hours).
- **Symptoms:** Audit Hub's log: `Integrity verification <id> FAILED: <n> failure(s), the first
<kind> in <application>/<category> seal <n> event <id>`; `pnpm --filter api audit status` (or the
  API image's `node dist/integrity/audit.cli.js status`) lists the run as `failed`.
- **Impact:** records of the audit log no longer match the seals signed when they were written
  (docs/adr/0008). By kind: `event_modified`, `personal_modified`, `location_modified` (a row
  edited), `event_deleted` (deleted outside retention), `event_inserted` (added into a sealed
  window), `seal_modified`, `chain_broken`, `seal_missing`, `window_gap`, `leaves_modified`,
  `signature_invalid` (the seals themselves changed), `signature_unverifiable` (signed with a key no
  longer configured). Until explained, the log is not evidence: treat it as a security incident
  (runbook 11), SEV1.
- **First checks:** run `audit verify` again (it names every failure, by id only) and keep its
  output. Was a database restored, or a migration or a script run against the audit tables, in
  the same hours? Was `AUDIT_INTEGRITY_KEY` rotated without keeping the old one in
  `AUDIT_INTEGRITY_KEY_PREVIOUS` (only `signature_unverifiable` then)? Who connects to the
  database as its owner or a superuser (the database's own logs and audit, the provider's access
  log)?
- **Signals:** `app_integrity_checks_total` by `outcome`; the `integrity_verifications` rows; the
  database's connection and DDL logs.
- **Immediate actions:** the security contact. Keep everything: a database snapshot now, the
  verification's output, the last checkpoint digests kept outside Audit Hub. Change nothing in the
  audit tables; revoke database credentials that may have leaked.
- **Mitigation:** a key rotated too early: put the old key back as
  `AUDIT_INTEGRITY_KEY_PREVIOUS` and verify again. A restore: the seals written after the restored
  point are lost with it, and the restored data verifies on its own; record the restore. Anything
  else: an investigation of who changed what, from the snapshot, the export
  (`audit export --app <slug> --from … --to …`, checked offline with `audit verify-export`) and the
  database's logs. Never re-seal or edit records to make the verification pass.
- **Roll back when:** never by changing the audit tables.
- **Recovered when:** the cause is known and recorded, and a full verification passes, or the
  failures it still reports are documented in the incident.

### 21. Audit log sealing stalled

- **Alerts:** `AuditHubSealingStalled` (an application's oldest unsealed event older than 15
  minutes, for 10 minutes).
- **Symptoms:** `app_integrity_unsealed_age_seconds` rising; Audit Hub's log: `Sealing paused:
<reason>`; `audit status` shows events waiting and an old `sealed through`.
- **Impact:** the events are stored, but not yet protected by a seal: a change to them before they
  are sealed would go unnoticed. Retention does not delete unsealed events either.
- **First checks:** the `Sealing paused` reason; the database (runbook 3; long transactions or
  locks on `integrity_seals`); whether every API instance is down or restarting (the sealer runs in
  each instance, under an advisory lock per stream); the clock of the database host.
- **Signals:** `app_integrity_unsealed_age_seconds`, `app_server_errors_total{error_origin="database"}`,
  `pg_stat_activity` for long transactions holding `pg_advisory_xact_lock`.
- **Immediate actions:** none beyond the database checks; `audit seal` runs a pass by hand and
  says how many seals it wrote.
- **Mitigation:** fix the database or the instances; the sealer catches up on its own, a window of
  up to 20,000 events at a time.
- **Roll back when:** a deployment of Audit Hub started it.
- **Recovered when:** the unsealed age is back under 5 minutes.

### 22. A daily audit job stopped running

- **Alerts:** `AuditHubIntegrityCheckMissing` (no successful integrity verification for 26
  hours), `AuditHubRetentionSweepMissing` (no successful retention sweep for 26 hours).
- **Symptoms:** `app_job_last_success_timestamp_seconds{job_name=…}` more than a day old (0: it
  never succeeded); Audit Hub's log: `Job <name> failed: <reason>`, `Integrity jobs skipped`,
  `Retention sweep skipped`; `SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 20`.
- **Impact:** verification: changes to the audit log go unnoticed meanwhile. Retention: records,
  personal data and coordinates are kept past their periods, against the privacy notice
  (docs/security.md).
- **First checks:** the failed runs' `detail` in `job_runs`; the coordination store (the jobs take
  a lock in Redis when `REDIS_URL` is set: runbook 4); the database (runbook 3); whether any API
  instance stays up for 5 minutes (the jobs check every hour, from 5 minutes after boot).
- **Signals:** `app_job_last_success_timestamp_seconds`, the `job_runs` rows, the error log.
- **Immediate actions:** run the job by hand: `audit verify` and `audit checkpoint`, or
  `audit retention` (the same code as the scheduled run; it refuses whatever the database
  refuses).
- **Mitigation:** fix the cause the failed run recorded. A verification that takes too long:
  `audit verify --since <date>` covers what changed, and the weekly full run can then run at a
  quiet hour.
- **Roll back when:** a deployment of Audit Hub started it.
- **Recovered when:** a scheduled run succeeds and the gauge is recent again.

### 23. Database role can change audit records

- **Alerts:** `AuditHubDatabasePrivilegesTooBroad` (critical: the API's role has UPDATE or
  DELETE on the append-only tables).
- **Symptoms:** `app_database_privileges_ok` at 0; Audit Hub's log at boot: `The API's database
role can update or delete audit_events, …`.
- **Impact:** the triggers still refuse any update or delete, but the first wall is down: whoever
  takes over the API's credentials is one step closer to changing the audit log (docs/adr/0007).
- **First checks:** which role the API connects as (`DATABASE_URL`: it must be `app_runtime`, not
  the migrator that owns the tables); whether a `GRANT … ON ALL TABLES` ran after the last
  migration (roles.sql, a manual grant) without `audit_apply_runtime_privileges` after it.
- **Signals:** `app_database_privileges_ok`; `SELECT has_table_privilege('app_runtime',
'audit_events', 'UPDATE')`.
- **Immediate actions:** connected as the migrator: `SELECT
audit_apply_runtime_privileges('app_runtime');`. If the API ran as the owner, point
  `DATABASE_URL` at `app_runtime` and redeploy ([deploy-vps.md](deploy-vps.md#5-the-database)).
- **Mitigation:** run `pnpm --filter api audit verify` to check nothing changed while the rights
  were broad; keep the output with the incident.
- **Roll back when:** a deployment changed the API's `DATABASE_URL`.
- **Recovered when:** the gauge is 1 on every instance and the verification passes.

### 24. Webhooks failing or backed up

- **Alerts:** `AuditHubWebhooksFailing` (three or more failed attempts to one application or chat
  channel in 30 minutes), `AuditHubWebhookBacklog` (the oldest waiting delivery older than 15
  minutes, for 10 minutes).
- **Symptoms:** `app_webhook_deliveries_total` with `retry`, `failed`, `unauthorized` or `expired`
  by `connected_app` and `target`; the application's webhook deliveries in the admin pages
  (`GET /api/connected-apps/:id/webhook-deliveries`: the last HTTP status and the error category,
  never a body); Audit Hub's log, context `Webhooks`: `Could not deliver …`, `Gave up on …`.
- **Impact:** the application does not hear about its alerts, cannot ask its users "Was it you?",
  and response actions do not reach it. Deliveries are kept and retried for 24 hours (12
  attempts, 30 s doubling to an hour), then dropped; a response action then expires.
- **First checks:** by `lastError`: `unauthorized` (401: the application verifies with another
  webhook secret: rotated on one side only, or its `AUDIT_HUB_WEBHOOK_SECRET` is wrong; not
  retried); `http_404` (its route is not where its webhook URL says: the connector not installed,
  or the URL mistyped); `http_5xx`, `timeout`, `network` (the application is down or slow: its own
  health); `blocked_address` (the URL resolves to a private address: SSRF protection, see
  `AUDIT_WEBHOOKS_ALLOW_PRIVATE_NETWORKS`); `insecure_url` (http in production);
  `not_configured` (the URL or the chat variable was removed). A backlog with no failures: the
  workers (every API instance runs one) or the database.
- **Signals:** `app_webhook_deliveries_total`, `app_webhook_outbox_waiting`,
  `app_webhook_outbox_oldest_age_seconds`, `app_dependency_duration_seconds{dependency_name=~"webhook.*"}`.
- **Immediate actions:** none on Audit Hub's side for a down application: its deliveries wait.
  Tell the application's owner.
- **Mitigation:** a secret out of step: rotate the webhook secret in Audit Hub and deploy the new
  `AUDIT_HUB_WEBHOOK_SECRET` (deliveries carry both signatures for 7 days). A wrong URL: fix it in
  the application's settings, then `POST /api/connected-apps/:id/webhook-test` to check. A chat
  channel: replace its webhook URL variable and restart.
- **Roll back when:** a deployment of Audit Hub or of the application started it.
- **Recovered when:** test webhooks are delivered and the backlog drains.

### 25. Security alerts unattended

- **Alerts:** `AuditHubSecurityAlertsUnattended` (high or critical alerts open or in review for
  more than an hour).
- **Symptoms:** the alerts page shows open high or critical alerts; `app_alerts_open` by
  `severity`.
- **Impact:** an account of a connected application may be under attack (brute force, credential
  stuffing, a session token reused, travel no person can make) and nobody is looking.
- **First checks:** each alert's rule, its events and its history (who was notified: the
  `notified` activity); whether the email and chat notifications arrived (runbooks 16 and 24).
- **Signals:** `app_alerts_open`, the alerts' events in the explorer.
- **Immediate actions:** assign the alert and set it `in_review`; for an account taken over, a
  response action (`revoke_sessions` first, the least harmful) with the application's owner.
- **Mitigation:** close each alert as `resolved` or `false_positive`, with a note saying why.
  Rules that keep raising false positives: tune their thresholds (docs/security.md#detection-rules)
  in a reviewed change.
- **Roll back when:** never; alerts are worked on, not rolled back.
- **Recovered when:** no high or critical alert is left unattended.

### 26. Detection rules behind

- **Alerts:** `AuditHubRulesBehind` (the oldest event the real-time rules have not read older than
  10 minutes, for 10 minutes), `AuditHubPeriodicRulesMissing` (no successful run of the periodic
  rules for 30 minutes).
- **Symptoms:** `app_rules_cursor_lag_seconds` rising; `app_job_last_success_timestamp_seconds{job_name="rules_periodic"}`
  old; Audit Hub's log, context `Rules`: `Real-time rules paused: …`, `Periodic rules skipped: …`,
  context `Jobs`: `Job rules_periodic failed: …`.
- **Impact:** suspicious sign-ins, brute force, account deletions (their erasure) and response
  action outcomes are handled late; nothing is lost: the real-time rules read every event in
  order when they resume.
- **First checks:** the database (runbook 3; long transactions or locks: each batch is one
  transaction under the advisory lock `rules-realtime`); a burst of events (the lag falls once
  the batches catch up, 200 events a batch); the failed runs in `job_runs`.
- **Signals:** `app_rules_cursor_lag_seconds`, `app_ingest_events_total`, the `rule_cursors` rows.
- **Immediate actions:** none beyond the database checks.
- **Mitigation:** fix the cause; the rules catch up on their own. An event a rule cannot handle
  would stop the cursor: its id is in the `Real-time rules paused` line; fix the rule (never skip
  the event by moving the cursor by hand without recording why).
- **Roll back when:** a deployment of Audit Hub started it.
- **Recovered when:** the lag is back under a minute and the periodic rules run every 5 minutes.

### 27. IP geolocation database stale

- **Alerts:** `AuditHubGeoIpDatabaseStale` (the loaded database built more than 45 days ago).
- **Symptoms:** `app_geoip_database_age_days` above 45; Audit Hub's log at boot: `IP geolocation
on: database built N days ago`.
- **Impact:** addresses that moved since are placed wrongly: new country and impossible travel
  signals grow less reliable (false positives and misses).
- **First checks:** when the files under `GEOIP_CITY_DB_PATH` and `GEOIP_ASN_DB_PATH` were last
  replaced (docs/adr/0011: a monthly, manual download).
- **Signals:** `app_geoip_database_age_days`.
- **Immediate actions:** none.
- **Mitigation:** download this month's DB-IP Lite City and ASN `.mmdb` files (or the database the
  deployment's records name), replace the mounted files, restart the API instances one at a time.
- **Roll back when:** never.
- **Recovered when:** the gauge reads a few days.

## After the incident

Within a few working days, a blameless postmortem for every SEV1 and SEV2, and for any incident
that spent more than 20 % of an error budget ([alerting.md](alerting.md#error-budget)):

```
Summary          one paragraph: what users saw, how long
Impact           users, requests or data affected; error budget spent
Timeline         first failure, detection, acknowledgement, mitigation, recovery (with times)
Root cause       and the conditions that let it happen
Detection        which alert fired first; if none, which one should have
What went well   and what did not
Action items     each with an owner and a date: tests, alerts, runbooks, limits
```

Update this page when a runbook was wrong or missing, and [alerting.md](alerting.md) when an alert
fired late, never, or for nothing.
