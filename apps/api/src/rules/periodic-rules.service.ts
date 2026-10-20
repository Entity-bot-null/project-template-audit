import { createHmac } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AlertsService, type RaiseAlert } from '../alerts/alerts.service.js';
import { RuleSettingsService } from '../alerts/rule-settings.service.js';
import type { Tag } from 'audit-contract';
import { errorSummary } from '../common/logging/error-summary.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { hubActionsTagged } from '../hub-audit/hub-actions.js';
import { JobRunsService } from '../integrity/job-runs.service.js';
import { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BRUTE_FORCE_ACCOUNT,
  BRUTE_FORCE_IP,
  MASS_DELETE,
  MASS_EXPORT,
  MASS_READ,
  MULTI_APP_APPS,
  MULTI_APP_FAILURES,
  PERIODIC_INTERVAL_MS,
  PERIODIC_WINDOW_MS,
  REALTIME_HORIZON_MS,
  RULES_KEY,
  STUFFING_ACCOUNTS,
  TOKEN_REUSE_ACCOUNTS,
  TOKEN_REUSE_WINDOW_MS,
} from './rules.constants.js';

export const PERIODIC_CURSOR = 'periodic';
const LOCK_KEY = 'rules-periodic';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

type Tx = Prisma.TransactionClient;

/** One group a rule found: its application, key and the events behind it. */
interface Found {
  appId: string;
  key: string;
  count: number;
  distinct?: number;
  apps?: number;
  eventPks: string[];
  last: Date;
}

/** What a run raised, per rule. */
export type PeriodicSummary = Record<string, number>;

/** The failed sign-in rules' thresholds for a pass (their settings over rules.constants.ts). */
interface FailureThresholds {
  account: number;
  ip: number;
  stuffing: number;
  multiAppApps: number;
  multiAppFailures: number;
}

// The rules over a window of events (docs/security.md#detection-rules), every
// 5 minutes on the last 15: brute force against an account or from an IP,
// credential stuffing, bulk exports, deletions and reads, one session used by
// several accounts, one IP failing against several applications. A group
// alerts again only with events newer than the previous run (the open alert
// takes the occurrence), never twice for the same evidence. IPs never reach
// an alert: groups are keyed by an HMAC of the address (RULES_KEY). One
// instance at a time; every run is a job_runs row (rules_periodic).
@Injectable()
export class PeriodicRulesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rules');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly jobs: JobRunsService,
    @Inject(RULES_KEY) private readonly key: Buffer,
    private readonly settings: RuleSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.scheduled(), PERIODIC_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  async scheduled(): Promise<void> {
    try {
      await this.jobs.run(
        'rules_periodic',
        () => this.run(),
        (summary) => summary,
      );
    } catch (error) {
      this.logger.warn(`Periodic rules skipped: ${errorSummary(error)}`);
    }
  }

  /** One pass of every rule. Answers how many alerts each raised or added to. */
  async run(): Promise<PeriodicSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean; horizon: Date }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS "locked",
                 date_trunc('milliseconds', now() - make_interval(secs => ${REALTIME_HORIZON_MS / 1000})) AS "horizon"`;
        if (lock?.locked !== true) return {};
        const horizon = lock.horizon;
        const from = new Date(horizon.getTime() - PERIODIC_WINDOW_MS);
        const cursor = await tx.ruleCursor.findUnique({ where: { name: PERIODIC_CURSOR } });
        // Only groups with events since the previous run's horizon alert.
        const since = cursor === null || cursor.recordedAt < from ? from : cursor.recordedAt;
        const summary: PeriodicSummary = {};
        const raise = async (found: Found[], alert: (group: Found) => RaiseAlert) => {
          for (const group of found) {
            const input = alert(group);
            if ((await this.alerts.raise(tx, input)) !== null) {
              summary[input.rule] = (summary[input.rule] ?? 0) + 1;
            }
          }
        };
        // Each rule's settings for this pass: a rule turned off is not even queried.
        const settings = await this.settings.snapshot();
        const on = (rule: string) => settings.of(rule).enabled;
        const param = (rule: string, name: string, fallback: number) =>
          settings.of(rule).params[name] ?? fallback;
        const thresholds: FailureThresholds = {
          account: param('brute_force_account', 'failures', BRUTE_FORCE_ACCOUNT),
          ip: param('brute_force_ip', 'failures', BRUTE_FORCE_IP),
          stuffing: param('credential_stuffing', 'accounts', STUFFING_ACCOUNTS),
          multiAppApps: param('multi_app_attack', 'applications', MULTI_APP_APPS),
          multiAppFailures: param('multi_app_attack', 'failures', MULTI_APP_FAILURES),
        };

        const failures = [
          'brute_force_account',
          'brute_force_ip',
          'credential_stuffing',
          'multi_app_attack',
        ].some(on)
          ? await this.failures(tx, from, horizon, since, thresholds)
          : { byAccount: [], byIp: [], stuffing: [], multiApp: [] };
        await raise(failures.byAccount, (group) => ({
          appId: group.appId,
          rule: 'brute_force_account',
          severity: 'high',
          groupKey: `brute_force_account:${group.appId}:${group.key}`,
          ...(isEmailHmac(group.key) ? {} : { subject: group.key }),
          title: `${String(group.count)} failed sign-ins of one account in 15 minutes`,
          summary: { failures: group.count, account: group.key },
          eventPks: group.eventPks,
          at: group.last,
        }));
        await raise(failures.byIp, (group) => ({
          appId: group.appId,
          rule: 'brute_force_ip',
          severity: 'high',
          groupKey: `brute_force_ip:${group.appId}:${this.pseudonym(group.key)}`,
          title: `${String(group.count)} failed sign-ins from one address in 15 minutes`,
          summary: {
            failures: group.count,
            accounts: group.distinct ?? 0,
            source: this.pseudonym(group.key),
          },
          eventPks: group.eventPks,
          at: group.last,
        }));
        await raise(failures.stuffing, (group) => ({
          appId: group.appId,
          rule: 'credential_stuffing',
          severity: 'critical',
          groupKey: `credential_stuffing:${group.appId}:${this.pseudonym(group.key)}`,
          title: `Sign-ins of ${String(group.distinct ?? 0)} accounts failing from one address in 15 minutes`,
          summary: {
            failures: group.count,
            accounts: group.distinct ?? 0,
            source: this.pseudonym(group.key),
          },
          eventPks: group.eventPks,
          at: group.last,
        }));
        for (const found of failures.multiApp) {
          await raise([found], (group) => ({
            appId: group.appId,
            rule: 'multi_app_attack',
            severity: 'high',
            groupKey: `multi_app_attack:${group.appId}:${this.pseudonym(group.key)}`,
            title: `One address failing sign-ins against ${String(group.apps ?? 0)} connected applications`,
            summary: {
              failures: group.count,
              applications: group.apps ?? 0,
              source: this.pseudonym(group.key),
            },
            eventPks: group.eventPks,
            at: group.last,
          }));
        }

        for (const [tag, threshold, rule, severity, noun] of [
          ['data.bulk_export', MASS_EXPORT, 'mass_export', 'high', 'bulk exports'],
          ['data.bulk_delete', MASS_DELETE, 'mass_delete', 'high', 'bulk deletions'],
          ['data.read_other_user', MASS_READ, 'mass_read', 'medium', "reads of other users' data"],
        ] as const) {
          if (!on(rule)) continue;
          const found = await this.byActor(
            tx,
            tag,
            param(rule, 'count', threshold),
            from,
            horizon,
            since,
          );
          await raise(found, (group) => ({
            appId: group.appId,
            rule,
            severity,
            groupKey: `${rule}:${group.appId}:${group.key}`,
            subject: group.key,
            title: `${String(group.count)} ${noun} by user ${group.key} in 15 minutes`,
            summary: { subject: group.key, count: group.count },
            eventPks: group.eventPks,
            at: group.last,
          }));
        }

        const reused = on('token_reuse')
          ? await this.tokenReuse(
              tx,
              horizon,
              since,
              param('token_reuse', 'accounts', TOKEN_REUSE_ACCOUNTS),
            )
          : [];
        await raise(reused, (group) => ({
          appId: group.appId,
          rule: 'token_reuse',
          severity: 'critical',
          groupKey: `token_reuse:${group.appId}:${group.key}`,
          title: `One session used by ${String(group.distinct ?? 0)} accounts within an hour`,
          summary: { accounts: group.distinct ?? 0, session: group.key.slice(0, 16) },
          eventPks: group.eventPks,
          at: group.last,
        }));

        await tx.ruleCursor.upsert({
          where: { name: PERIODIC_CURSOR },
          create: { name: PERIODIC_CURSOR, recordedAt: horizon, eventPk: ZERO_UUID },
          update: { recordedAt: horizon },
        });
        const raised = Object.values(summary).reduce((total, count) => total + count, 0);
        if (raised > 0) this.logger.log(`Periodic rules: ${JSON.stringify(summary)}`);
        return summary;
      },
      { timeout: 120_000 },
    );
  }

  /** The address of a group, as alerts and logs carry it: an HMAC, never the IP. */
  private pseudonym(ip: string): string {
    return createHmac('sha256', this.key).update(ip).digest('hex').slice(0, 16);
  }

  /** Failed sign-ins in the window, grouped by account, by IP, and by IP across applications. */
  private async failures(
    tx: Tx,
    from: Date,
    horizon: Date,
    since: Date,
    limits: FailureThresholds,
  ) {
    // A failed sign-in: an action tagged auth.sign_in_failed, or auth.sign_in
    // with any outcome but success. The account is the actor, its email's
    // pseudonym, or the user it was about.
    const base = (filter: Prisma.Sql) => tx.$queryRaw<
      {
        appId: string;
        key: string;
        count: number;
        distinct: number;
        apps: number;
        eventPks: string[];
        last: Date;
      }[]
    >`
      WITH f AS (
        SELECT e."id", e."app_id", e."recorded_at", p."ip",
               coalesce(e."actor_id", e."actor_email_hmac",
                        CASE WHEN e."resource_type" = 'user' THEN e."resource_id" END) AS "account"
        FROM "audit_events" e
        LEFT JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id" AND ca."action" = e."action"
        LEFT JOIN "event_personal" p ON p."event_pk" = e."id"
        WHERE e."recorded_at" >= ${from} AND e."recorded_at" < ${horizon}
          AND ('auth.sign_in_failed' = ANY(ca."tags")
               OR ('auth.sign_in' = ANY(ca."tags") AND e."outcome" <> 'success')
               OR (e."app_id" = ${SYSTEM_APP_ID}::uuid AND e."action" = ANY(${hubActionsTagged('auth.sign_in_failed')}::text[])))
      )
      ${filter}`;
    const byAccount = await base(Prisma.sql`
      SELECT "app_id" AS "appId", "account" AS "key", count(*)::int AS "count", 0 AS "distinct", 1 AS "apps",
             (array_agg("id" ORDER BY "recorded_at"))[1:100]::text[] AS "eventPks", max("recorded_at") AS "last"
      FROM f WHERE "account" IS NOT NULL
      GROUP BY "app_id", "account"
      HAVING count(*) >= ${limits.account} AND max("recorded_at") >= ${since}`);
    const perIp = await base(Prisma.sql`
      SELECT "app_id" AS "appId", "ip" AS "key", count(*)::int AS "count",
             count(DISTINCT "account")::int AS "distinct", 1 AS "apps",
             (array_agg("id" ORDER BY "recorded_at"))[1:100]::text[] AS "eventPks", max("recorded_at") AS "last"
      FROM f WHERE "ip" IS NOT NULL
      GROUP BY "app_id", "ip"
      HAVING (count(*) >= ${limits.ip} OR count(DISTINCT "account") >= ${limits.stuffing})
         AND max("recorded_at") >= ${since}`);
    // Across applications: only between those with correlation on.
    const crossApp = await base(Prisma.sql`
      , per_app AS (
        SELECT f."ip", f."app_id", count(*)::int AS "count",
               (array_agg(f."id" ORDER BY f."recorded_at"))[1:100]::text[] AS "eventPks",
               max(f."recorded_at") AS "last"
        FROM f JOIN "connected_apps" a ON a."id" = f."app_id" AND a."correlation_enabled"
        WHERE f."ip" IS NOT NULL
        GROUP BY f."ip", f."app_id"
      ), ips AS (
        SELECT "ip" FROM per_app GROUP BY "ip"
        HAVING count(*) >= ${limits.multiAppApps} AND sum("count") >= ${limits.multiAppFailures}
           AND max("last") >= ${since}
      )
      SELECT per_app."app_id" AS "appId", per_app."ip" AS "key", per_app."count", 0 AS "distinct",
             (SELECT count(*)::int FROM per_app inner_app WHERE inner_app."ip" = per_app."ip") AS "apps",
             per_app."eventPks", per_app."last"
      FROM per_app JOIN ips ON ips."ip" = per_app."ip"`);
    return {
      byAccount,
      byIp: perIp.filter((group) => group.count >= limits.ip),
      stuffing: perIp.filter((group) => group.distinct >= limits.stuffing),
      multiApp: crossApp,
    };
  }

  /** Events with `tag` per actor, at least `threshold` of them in the window. */
  private byActor(tx: Tx, tag: Tag, threshold: number, from: Date, horizon: Date, since: Date) {
    return tx.$queryRaw<Found[]>`
      SELECT e."app_id" AS "appId", e."actor_id" AS "key", count(*)::int AS "count",
             (array_agg(e."id" ORDER BY e."recorded_at"))[1:100]::text[] AS "eventPks",
             max(e."recorded_at") AS "last"
      FROM "audit_events" e
      LEFT JOIN "catalog_actions" ca ON ca."catalog_version_id" = e."catalog_version_id" AND ca."action" = e."action"
      WHERE e."recorded_at" >= ${from} AND e."recorded_at" < ${horizon}
        AND (${tag} = ANY(ca."tags")
             OR (e."app_id" = ${SYSTEM_APP_ID}::uuid AND e."action" = ANY(${hubActionsTagged(tag)}::text[])))
        AND e."actor_id" IS NOT NULL
      GROUP BY e."app_id", e."actor_id"
      HAVING count(*) >= ${threshold} AND max(e."recorded_at") >= ${since}`;
  }

  /** One session reference used by several accounts within the last hour. */
  private tokenReuse(tx: Tx, horizon: Date, since: Date, accounts: number) {
    const from = new Date(horizon.getTime() - TOKEN_REUSE_WINDOW_MS);
    return tx.$queryRaw<Found[]>`
      SELECT e."app_id" AS "appId", e."session_ref" AS "key", count(*)::int AS "count",
             count(DISTINCT e."actor_id")::int AS "distinct",
             (array_agg(e."id" ORDER BY e."recorded_at"))[1:100]::text[] AS "eventPks",
             max(e."recorded_at") AS "last"
      FROM "audit_events" e
      WHERE e."recorded_at" >= ${from} AND e."recorded_at" < ${horizon}
        AND e."session_ref" IS NOT NULL AND e."actor_id" IS NOT NULL
      GROUP BY e."app_id", e."session_ref"
      HAVING count(DISTINCT e."actor_id") >= ${accounts} AND max(e."recorded_at") >= ${since}`;
  }
}

/** An email's pseudonym (64 hex): an account without its user id is not named as a subject. */
function isEmailHmac(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}
