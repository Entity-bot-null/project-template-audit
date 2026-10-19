import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AppAccessService } from '../access/app-access.service.js';
import { errorSummary } from '../common/logging/error-summary.js';
import type { RequestUser } from '../common/types/request-user.js';
import { SYSTEM_APP_ID } from '../connected-apps/connected-apps.service.js';
import { env } from '../env/env.js';
import type { EventSummary } from '../explorer/dto/explorer.schemas.js';
import { ExplorerService, SUMMARY_SELECT } from '../explorer/explorer.service.js';
import { MailOutboxService } from '../infrastructure/mail/mail-outbox.service.js';
import { observeOpenAlerts } from '../observability/metrics.js';
import type { AlertStatus, AuditSeverity, Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { slackMessage, teamsMessage } from '../webhooks/chat-messages.js';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import { deviceLabel, explainAlert } from './alert-explanation.js';
import type {
  AlertDetailResponse,
  AlertListQuery,
  AlertResponse,
  UpdateAlertDto,
} from './dto/alert.schemas.js';

/** What a rule found: one alert, or one more occurrence of the open one with its group key. */
export interface RaiseAlert {
  appId: string;
  /** The rule's name (alert.created's `rule`): snake_case. */
  rule: string;
  severity: AuditSeverity;
  /** Occurrences with the same key go to the same open alert. */
  groupKey: string;
  /** The application's user it is about, when one person. */
  subject?: string;
  /** Ids and counts only: never an email, an IP or a name. */
  title: string;
  /** Ids, counts, countries, signals: never an email or an IP. */
  summary: Record<string, string | number | boolean | string[]>;
  /** Audit Hub's ids of the events behind it (the first 100 are kept). */
  eventPks: string[];
  at: Date;
}

export interface RaisedAlert {
  id: string;
  created: boolean;
}

/** Each severity's rank: notifications by email from high, by chat from medium. */
const RANK: Record<AuditSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const EMAIL_FROM: AuditSeverity = 'high';
const CHAT_FROM: AuditSeverity = 'medium';
const MAX_ALERT_EVENTS = 100;
const STATS_INTERVAL_MS = 30_000;
/** The longest list of the evidence (its most frequent values). */
const TALLY_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The events behind an alert as its detail reads them: the explorer's summary and the evidence. */
const EVIDENCE_SELECT = {
  ...SUMMARY_SELECT,
  reason: true,
  actorEmailHmac: true,
  uaBrowser: true,
  uaOs: true,
  clientDeviceModel: true,
  personal: { select: { actorLabel: true, resourceLabel: true } },
} satisfies Prisma.AuditEventSelect;

type EvidenceRow = Prisma.AuditEventGetPayload<{ select: typeof EVIDENCE_SELECT }>;

const TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  open: ['in_review', 'resolved', 'false_positive'],
  in_review: ['open', 'resolved', 'false_positive'],
  resolved: ['open'],
  false_positive: ['open'],
};

type Tx = Prisma.TransactionClient;

// Alerts (docs/design/audit-hub): grouped so a burst never floods anyone (one
// open alert per group key, partial unique index alerts_open_group_key: a
// rule firing again adds an occurrence), notified once when created (the
// application's webhook; email to the administrators and the application's
// auditors from high; Slack and Teams from medium, when configured), and
// worked on by people: status, assignee, notes, every change in
// alert_activities (append-only). Read, an alert says why it fired in words,
// what the events behind it have in common and who is in it by name, all
// looked up when read: the alert itself keeps ids and counts only.
@Injectable()
export class AlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Alerts');
  private timer: NodeJS.Timeout | undefined;
  private openBySeverity: Map<string, number> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AppAccessService,
    private readonly webhooks: WebhookOutboxService,
    private readonly mail: MailOutboxService,
    private readonly explorer: ExplorerService,
  ) {}

  onApplicationBootstrap(): void {
    observeOpenAlerts(() => this.openBySeverity);
    this.timer = setInterval(() => void this.refreshStats(), STATS_INTERVAL_MS).unref();
    void this.refreshStats();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** In the caller's transaction: the alert and its notifications commit with what found it. */
  async raise(tx: Tx, input: RaiseAlert): Promise<RaisedAlert> {
    const [row] = await tx.$queryRaw<{ id: string; created: boolean }[]>`
      INSERT INTO "alerts" ("id", "app_id", "rule", "severity", "group_key", "subject", "title",
                            "summary", "first_seen_at", "last_seen_at", "updated_at")
      VALUES (uuidv7(), ${input.appId}::uuid, ${input.rule}, ${input.severity}::"AuditSeverity",
              ${input.groupKey}, ${input.subject ?? null}, ${input.title},
              ${JSON.stringify(input.summary)}::jsonb, ${input.at}, ${input.at}, now())
      ON CONFLICT ("group_key") WHERE "status" IN ('open', 'in_review')
      DO UPDATE SET "occurrences" = "alerts"."occurrences" + 1,
                    "last_seen_at" = greatest("alerts"."last_seen_at", EXCLUDED."last_seen_at"),
                    "severity" = greatest("alerts"."severity", EXCLUDED."severity"),
                    "summary" = EXCLUDED."summary",
                    "updated_at" = now()
      RETURNING "id", "occurrences" = 1 AS "created"`;
    if (row === undefined) throw new Error('The alert was neither created nor updated');
    if (input.eventPks.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "alert_events" ("alert_id", "event_pk")
        SELECT ${row.id}::uuid, pk FROM unnest(${input.eventPks}::uuid[]) AS pk
        LIMIT greatest(0, ${MAX_ALERT_EVENTS} - (SELECT count(*) FROM "alert_events" WHERE "alert_id" = ${row.id}::uuid))
        ON CONFLICT DO NOTHING`;
    }
    if (row.created) {
      await tx.alertActivity.create({ data: { alertId: row.id, kind: 'created' } });
      await this.notify(tx, row.id, input);
      this.logger.warn(
        `Alert ${row.id}: ${input.rule} (${input.severity}) in application ${input.appId}`,
      );
    }
    return row;
  }

  private async notify(tx: Tx, alertId: string, input: RaiseAlert): Promise<void> {
    const app = await tx.connectedApp.findUniqueOrThrow({
      where: { id: input.appId },
      select: { slug: true, name: true, system: true },
    });
    const notified: string[] = [];
    if (!app.system && input.eventPks.length > 0) {
      const first = await tx.auditEvent.findFirst({
        where: { id: { in: input.eventPks } },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        select: { eventId: true },
      });
      const queued =
        first === null
          ? undefined
          : await this.webhooks.toApp(
              {
                appId: input.appId,
                type: 'alert.created',
                data: {
                  alertId,
                  rule: input.rule,
                  severity: input.severity,
                  ...(input.subject === undefined ? {} : { subject: input.subject }),
                  summary: input.title.slice(0, 500),
                  firstEventId: first.eventId,
                },
              },
              tx,
            );
      if (queued !== undefined) notified.push('webhook');
    }
    if (RANK[input.severity] >= RANK[CHAT_FROM]) {
      const alert = {
        appSlug: app.slug,
        appName: app.name,
        rule: input.rule,
        severity: input.severity,
        title: input.title,
        ...(env.APP_ORIGIN === undefined ? {} : { url: `${env.APP_ORIGIN}/alerts/${alertId}` }),
      };
      for (const target of this.webhooks.chatTargets) {
        const body = target === 'slack' ? slackMessage(alert) : teamsMessage(alert);
        await this.webhooks.toChat(target, 'alert.created', body, tx);
        notified.push(target);
      }
    }
    if (RANK[input.severity] >= RANK[EMAIL_FROM] && this.mail.enabled) {
      const recipients = await tx.user.findMany({
        where: {
          disabledAt: null,
          OR: [
            { role: 'admin' },
            { role: 'auditor', appAssignments: { some: { appId: input.appId } } },
          ],
        },
        select: { id: true, email: true },
      });
      for (const recipient of recipients) {
        await this.mail.enqueue(tx, {
          kind: 'security_alert',
          to: recipient.email,
          userId: recipient.id,
          payload: { alertId },
          dedupeKey: `security_alert:${alertId}:${recipient.id}`,
        });
      }
      if (recipients.length > 0) notified.push('email');
    }
    if (notified.length > 0) {
      await tx.alertActivity.create({
        data: { alertId, kind: 'notified', note: notified.join(', ') },
      });
    }
  }

  async list(user: RequestUser, query: AlertListQuery) {
    const visible = await this.access.appFilter(user);
    if (query.appId !== undefined && !(await this.access.canSee(user, query.appId))) {
      return { items: [], total: 0 };
    }
    const where: Prisma.AlertWhereInput = {
      ...visible,
      ...(query.appId === undefined ? {} : { appId: query.appId }),
      ...(query.status === undefined ? {} : { status: { in: query.status } }),
      ...(query.severity === undefined ? {} : { severity: { in: query.severity } }),
      ...(query.rule === undefined ? {} : { rule: query.rule }),
      ...(query.assigneeId === undefined ? {} : { assigneeId: query.assigneeId }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
        include: { app: { select: { slug: true } } },
      }),
      this.prisma.alert.count({ where }),
    ]);
    const labels = await this.subjectLabels(rows);
    return { items: rows.map((row) => toResponse(row, labels.get(row.id) ?? null)), total };
  }

  async get(user: RequestUser, id: string): Promise<AlertDetailResponse> {
    const row = await this.prisma.alert.findUnique({
      where: { id },
      include: {
        app: { select: { slug: true } },
        activities: { orderBy: { createdAt: 'asc' } },
        events: { take: MAX_ALERT_EVENTS, select: { eventPk: true } },
      },
    });
    if (row === null || !(await this.access.canSee(user, row.appId))) {
      throw new NotFoundException('Alert not found');
    }
    const rows =
      row.events.length === 0
        ? []
        : await this.prisma.auditEvent.findMany({
            where: { id: { in: row.events.map((event) => event.eventPk) } },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
            select: EVIDENCE_SELECT,
          });
    const [events, staff] = await Promise.all([
      this.explorer.summaries(rows),
      this.staffNames([
        row.assigneeId,
        row.resolvedById,
        row.appId === SYSTEM_APP_ID ? row.subject : null,
        ...row.activities.flatMap((activity) => [
          activity.userId,
          activity.kind === 'assigned' ? activity.note : null,
        ]),
      ]),
    ]);
    const names = namesOf(rows, events, staff);
    const staffName = (userId: string | null) =>
      userId === null ? null : (staff.get(userId) ?? null);
    return {
      ...toResponse(row, row.subject === null ? null : (names.get(row.subject) ?? null)),
      summary: row.summary as Record<string, unknown>,
      explanation: explainAlert(
        {
          rule: row.rule,
          subject: row.subject,
          summary: row.summary as Record<string, unknown>,
          lastSeenAt: row.lastSeenAt,
        },
        names,
      ),
      evidence: evidenceOf(rows, events),
      assigneeLabel: staffName(row.assigneeId),
      resolvedByLabel: staffName(row.resolvedById),
      activities: row.activities.map((activity) => ({
        id: activity.id,
        kind: activity.kind,
        userId: activity.userId,
        userLabel: staffName(activity.userId),
        fromStatus: activity.fromStatus,
        toStatus: activity.toStatus,
        note: activity.note,
        assigneeLabel: activity.kind === 'assigned' ? staffName(activity.note) : null,
        createdAt: activity.createdAt.toISOString(),
      })),
      events,
    };
  }

  /**
   * The people alerts are about, in words, for a page of them: the latest
   * label their application sent with the events behind each (as the actor,
   * else as the user an event was about), one query for the page; the names
   * of Audit Hub's own accounts for its alerts.
   */
  private async subjectLabels(
    rows: { id: string; appId: string; subject: string | null }[],
  ): Promise<Map<string, string>> {
    const theirs = rows
      .filter((row) => row.subject !== null && row.appId !== SYSTEM_APP_ID)
      .map((row) => row.id);
    const ours = rows.filter((row) => row.subject !== null && row.appId === SYSTEM_APP_ID);
    const [found, staff] = await Promise.all([
      theirs.length === 0
        ? Promise.resolve([])
        : this.prisma.$queryRaw<{ alertId: string; label: string }[]>`
            SELECT DISTINCT ON (a."id") a."id" AS "alertId",
                   CASE WHEN e."actor_id" = a."subject" THEN p."actor_label" ELSE p."resource_label" END AS "label"
            FROM "alerts" a
            JOIN "alert_events" ae ON ae."alert_id" = a."id"
            JOIN "audit_events" e ON e."id" = ae."event_pk"
            JOIN "event_personal" p ON p."event_pk" = e."id"
            WHERE a."id" = ANY(${theirs}::uuid[])
              AND ((e."actor_id" = a."subject" AND p."actor_label" IS NOT NULL)
                OR (e."resource_type" = 'user' AND e."resource_id" = a."subject"
                    AND p."resource_label" IS NOT NULL))
            ORDER BY a."id", (e."actor_id" = a."subject") DESC, e."recorded_at" DESC, e."id" DESC`,
      this.staffNames(ours.map((row) => row.subject)),
    ]);
    const labels = new Map(found.map((row) => [row.alertId, row.label]));
    for (const row of ours) {
      const name = row.subject === null ? undefined : staff.get(row.subject);
      if (name !== undefined) labels.set(row.id, name);
    }
    return labels;
  }

  /** The names of Audit Hub's own accounts among `ids` (anything else is skipped). */
  private async staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null && UUID.test(id)))];
    if (wanted.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  /** Status and assignee, under the version the caller saw (409 when someone changed it since). */
  async update(user: RequestUser, id: string, input: UpdateAlertDto): Promise<AlertDetailResponse> {
    const current = await this.manageable(user, id);
    if (input.status !== undefined && input.status !== current.status) {
      if (!TRANSITIONS[current.status].includes(input.status)) {
        throw new ConflictException(`An alert ${current.status} cannot become ${input.status}`);
      }
    }
    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: input.assigneeId },
        select: { id: true, role: true, disabledAt: true },
      });
      if (
        // Unknown, or disabled: nobody to work on it.
        assignee?.disabledAt !== null ||
        !(await this.access.canManage({ id: assignee.id, role: assignee.role }, current.appId))
      ) {
        throw new ConflictException('The assignee cannot work on this application');
      }
    }
    const closing = input.status === 'resolved' || input.status === 'false_positive';
    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.alert.updateMany({
          where: { id, version: input.version },
          data: {
            version: { increment: 1 },
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
            ...(input.status === undefined
              ? {}
              : closing
                ? { resolvedAt: new Date(), resolvedById: user.id }
                : { resolvedAt: null, resolvedById: null }),
          },
        });
        if (count === 0) {
          throw new ConflictException('The alert changed since it was read: reload it');
        }
        if (input.status !== undefined && input.status !== current.status) {
          await tx.alertActivity.create({
            data: {
              alertId: id,
              kind: 'status_changed',
              userId: user.id,
              fromStatus: current.status,
              toStatus: input.status,
            },
          });
        }
        if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
          await tx.alertActivity.create({
            data: {
              alertId: id,
              kind: 'assigned',
              userId: user.id,
              note: input.assigneeId ?? 'unassigned',
            },
          });
        }
      });
    } catch (error) {
      // Reopened while a newer alert of the same group is open (alerts_open_group_key).
      if (error instanceof Error && error.message.includes('alerts_open_group_key')) {
        throw new ConflictException('A newer alert of the same group is open: work on that one');
      }
      throw error;
    }
    this.logger.log(`Alert ${id} updated by ${user.id}`);
    return this.get(user, id);
  }

  async addNote(user: RequestUser, id: string, note: string): Promise<AlertDetailResponse> {
    await this.manageable(user, id);
    await this.prisma.alertActivity.create({
      data: { alertId: id, kind: 'note', userId: user.id, note },
    });
    return this.get(user, id);
  }

  private async manageable(user: RequestUser, id: string) {
    const row = await this.prisma.alert.findUnique({
      where: { id },
      select: { id: true, appId: true, status: true, assigneeId: true },
    });
    if (row === null || !(await this.access.canSee(user, row.appId))) {
      throw new NotFoundException('Alert not found');
    }
    if (!(await this.access.canManage(user, row.appId))) {
      throw new NotFoundException('Alert not found');
    }
    return row;
  }

  private async refreshStats(): Promise<void> {
    try {
      const rows = await this.prisma.alert.groupBy({
        by: ['severity'],
        where: { status: { in: ['open', 'in_review'] } },
        _count: { _all: true },
      });
      const counts = new Map<string, number>(
        (['info', 'low', 'medium', 'high', 'critical'] as const).map((severity) => [severity, 0]),
      );
      for (const row of rows) counts.set(row.severity, row._count._all);
      this.openBySeverity = counts;
    } catch (error) {
      this.logger.warn(`Could not count the open alerts: ${errorSummary(error)}`);
    }
  }
}

/**
 * Who is who among an alert's events, by id: the label sent for the user an
 * event was about, then for its actor (it wins), the latest last; Audit Hub's
 * own accounts by their names.
 */
function namesOf(
  rows: EvidenceRow[],
  events: EventSummary[],
  staff: ReadonlyMap<string, string>,
): Map<string, string> {
  const names = new Map(staff);
  for (const row of rows) {
    const label = row.personal?.resourceLabel;
    if (row.resourceType === 'user' && row.resourceId !== null && label != null) {
      names.set(row.resourceId, label);
    }
  }
  for (const event of events) {
    if (event.actor.id !== null && event.actor.label !== null) {
      names.set(event.actor.id, event.actor.label);
    }
  }
  return names;
}

/** What the events behind an alert have in common (AlertDetailSchema.evidence). */
function evidenceOf(rows: EvidenceRow[], events: EventSummary[]): AlertDetailResponse['evidence'] {
  const accounts = rows
    .map(
      (row) =>
        row.actorId ?? row.actorEmailHmac ?? (row.resourceType === 'user' ? row.resourceId : null),
    )
    .filter((account) => account !== null);
  return {
    events: rows.length,
    from: rows[0]?.recordedAt.toISOString() ?? null,
    to: rows.at(-1)?.recordedAt.toISOString() ?? null,
    outcomes: tally(rows.map((row) => row.outcome)),
    reasons: tally(rows.map((row) => row.reason)),
    actions: tally(events.map((event) => event.description ?? event.action)),
    accounts: new Set(accounts).size,
    countries: tally(rows.map((row) => row.geoCountry)),
    devices: tally(
      rows.map((row) =>
        deviceLabel({ deviceModel: row.clientDeviceModel, browser: row.uaBrowser, os: row.uaOs }),
      ),
    ),
  };
}

/** How many times each value appears, most frequent first (then by value), at most TALLY_LIMIT. */
function tally(values: (string | null | undefined)[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value != null && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, TALLY_LIMIT);
}

function toResponse(
  row: {
    id: string;
    appId: string;
    app: { slug: string };
    rule: string;
    severity: AuditSeverity;
    status: AlertStatus;
    subject: string | null;
    title: string;
    occurrences: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    assigneeId: string | null;
    resolvedAt: Date | null;
    resolvedById: string | null;
    version: number;
  },
  subjectLabel: string | null,
): AlertResponse {
  return {
    id: row.id,
    appId: row.appId,
    appSlug: row.app.slug,
    rule: row.rule,
    severity: row.severity,
    status: row.status,
    subject: row.subject,
    subjectLabel,
    title: row.title,
    occurrences: row.occurrences,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    assigneeId: row.assigneeId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedById: row.resolvedById,
    version: row.version,
  };
}
