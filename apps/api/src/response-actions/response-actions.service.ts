import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type CatalogDocument, RESPONSE_ACTIONS, type ResponseAction } from 'audit-contract';
import { errorSummary } from '../common/logging/error-summary.js';
import type { RequestUser } from '../common/types/request-user.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service.js';
import { type ReplyStatus, WebhookWorker } from '../webhooks/webhook-worker.service.js';
import type { ClaimedDelivery } from '../webhooks/webhook.store.js';
import { WEBHOOK_TTL_MS } from '../webhooks/webhooks.constants.js';
import type {
  CreateResponseActionDto,
  ResponseActionListQuery,
  ResponseActionResponse,
} from './dto/response-action.schemas.js';

/** A request waits this long for its approval. */
export const APPROVAL_TTL_MS = 3_600_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

/** What the application reported in audit.response_action.executed. */
export const RESULTS = ['succeeded', 'failed', 'refused', 'unsupported'] as const;
export type ActionResult = (typeof RESULTS)[number];

type Tx = Prisma.TransactionClient;
type ActionRow = Prisma.ResponseActionGetPayload<object>;

// Response actions (docs/adr/0013): an administrator asks an application to
// act on one of its users: close every session, require a password change,
// disable the account. Possible only when Audit Hub's setting for the
// application and its catalog both allow the action (the application's own
// AUDIT_HUB_RESPONSE_ACTIONS is checked again on its side), with a reason,
// and a second administrator's approval when the application requires it
// (the default; a CHECK keeps the approver from being the requester). The
// request is a signed webhook; the application answers it, acts, and records
// audit.response_action.executed, which settles it.
@Injectable()
export class ResponseActionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ResponseActions');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookOutboxService,
    private readonly worker: WebhookWorker,
  ) {}

  onApplicationBootstrap(): void {
    this.worker.onReply('response_action.requested', (delivery, status) =>
      this.onReply(delivery, status),
    );
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  async request(
    user: RequestUser,
    input: CreateResponseActionDto,
  ): Promise<ResponseActionResponse> {
    const app = await this.prisma.connectedApp.findFirst({
      where: { id: input.appId, system: false },
      select: {
        id: true,
        status: true,
        webhookUrl: true,
        acceptedResponseActions: true,
        requireActionApproval: true,
      },
    });
    if (app === null) throw new NotFoundException('Application not found');
    if (!app.acceptedResponseActions.includes(input.action)) {
      throw new ConflictException(
        `${input.action} is not accepted for this application (its settings in Audit Hub)`,
      );
    }
    if (!(await this.catalogDeclares(app.id, input.action))) {
      throw new ConflictException(
        `${input.action} is not declared by the application's catalog (responseActions)`,
      );
    }
    if (app.webhookUrl === null) {
      throw new ConflictException('The application has no webhook URL to receive the request');
    }
    if (input.alertId !== undefined) {
      const alert = await this.prisma.alert.findUnique({
        where: { id: input.alertId },
        select: { appId: true },
      });
      if (alert?.appId !== app.id) throw new NotFoundException('Alert not found');
    }
    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.responseAction.create({
        data: {
          appId: app.id,
          subject: input.subject,
          action: input.action,
          reason: input.reason,
          alertId: input.alertId ?? null,
          requestedById: user.id,
          status: app.requireActionApproval ? 'pending_approval' : 'dispatched',
          expiresAt: new Date(
            now.getTime() + (app.requireActionApproval ? APPROVAL_TTL_MS : WEBHOOK_TTL_MS),
          ),
        },
      });
      return app.requireActionApproval ? row : this.dispatch(tx, row);
    });
    this.logger.log(
      `Response action ${created.id} (${created.action}) on application ${created.appId} requested by ${user.id}: ${created.status}`,
    );
    return toResponse(created);
  }

  /** A second administrator's approval: the request then goes to the application. */
  async approve(user: RequestUser, id: string): Promise<ResponseActionResponse> {
    const current = await this.prisma.responseAction.findUnique({ where: { id } });
    if (current === null) throw new NotFoundException('Response action not found');
    if (current.requestedById === user.id) {
      throw new ForbiddenException('A request is approved by someone other than its requester');
    }
    if (current.status !== 'pending_approval' || current.expiresAt <= new Date()) {
      throw new ConflictException(`The request is ${current.status}, not waiting for approval`);
    }
    const approved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.responseAction.updateMany({
        where: { id, status: 'pending_approval' },
        data: {
          approvedById: user.id,
          approvedAt: new Date(),
          status: 'dispatched',
          expiresAt: new Date(Date.now() + WEBHOOK_TTL_MS),
        },
      });
      if (count === 0) throw new ConflictException('The request changed since it was read');
      return this.dispatch(tx, await tx.responseAction.findUniqueOrThrow({ where: { id } }));
    });
    this.logger.log(`Response action ${id} approved by ${user.id}`);
    return toResponse(approved);
  }

  /** Withdraws a request still waiting for its approval. */
  async cancel(user: RequestUser, id: string): Promise<ResponseActionResponse> {
    const { count } = await this.prisma.responseAction.updateMany({
      where: { id, status: 'pending_approval' },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.responseAction.findUnique({
        where: { id },
        select: { status: true },
      });
      if (exists === null) throw new NotFoundException('Response action not found');
      throw new ConflictException(`The request is ${exists.status}: it can no longer be cancelled`);
    }
    this.logger.log(`Response action ${id} cancelled by ${user.id}`);
    return toResponse(await this.prisma.responseAction.findUniqueOrThrow({ where: { id } }));
  }

  async list(query: ResponseActionListQuery) {
    const where: Prisma.ResponseActionWhereInput = {
      ...(query.appId === undefined ? {} : { appId: query.appId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.responseAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.responseAction.count({ where }),
    ]);
    return { items: rows.map(toResponse), total };
  }

  async get(id: string): Promise<ResponseActionResponse> {
    const row = await this.prisma.responseAction.findUnique({ where: { id } });
    if (row === null) throw new NotFoundException('Response action not found');
    return toResponse(row);
  }

  /**
   * The outcome the application reported (audit.response_action.executed),
   * from its own event: only for a request of that application still waiting
   * for it. Answers whether it settled one.
   */
  async settle(
    tx: Tx,
    appId: string,
    report: { actionId: string; result: ActionResult },
    eventPk: string,
  ): Promise<boolean> {
    const { count } = await tx.responseAction.updateMany({
      where: { id: report.actionId, appId, status: 'dispatched' },
      data: { status: report.result, resultEventPk: eventPk, completedAt: new Date() },
    });
    if (count > 0) {
      this.logger.log(`Response action ${report.actionId}: ${report.result}`);
    }
    return count > 0;
  }

  /** The application's immediate answer: a refusal settles the request at once. */
  private async onReply(delivery: ClaimedDelivery, status: ReplyStatus): Promise<void> {
    if (status === 'accepted') return;
    const { count } = await this.prisma.responseAction.updateMany({
      where: { deliveryId: delivery.id, status: 'dispatched' },
      data: { status, completedAt: new Date() },
    });
    if (count > 0) this.logger.log(`Response action of delivery ${delivery.id}: ${status}`);
  }

  /** Requests nobody approved in an hour, and requests no application answered in a day. */
  async sweep(now: Date = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.responseAction.updateMany({
        where: { status: { in: ['pending_approval', 'dispatched'] }, expiresAt: { lte: now } },
        data: { status: 'expired', completedAt: now },
      });
      if (count > 0) this.logger.warn(`${String(count)} response action(s) expired`);
      return count;
    } catch (error) {
      this.logger.warn(`Response actions sweep failed: ${errorSummary(error)}`);
      return 0;
    }
  }

  private async dispatch(tx: Tx, row: ActionRow): Promise<ActionRow> {
    const deliveryId = await this.webhooks.toApp(
      {
        appId: row.appId,
        type: 'response_action.requested',
        data: {
          actionId: row.id,
          action: row.action,
          subject: row.subject,
          reason: row.reason,
          requestedAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        },
      },
      tx,
    );
    if (deliveryId === undefined) {
      throw new ConflictException('The application has no webhook URL to receive the request');
    }
    return tx.responseAction.update({ where: { id: row.id }, data: { deliveryId } });
  }

  private async catalogDeclares(appId: string, action: ResponseAction): Promise<boolean> {
    const latest = await this.prisma.catalogVersion.findFirst({
      where: { appId },
      orderBy: { publishedAt: 'desc' },
      select: { document: true },
    });
    const declared = (latest?.document as CatalogDocument | undefined)?.responseActions ?? [];
    return declared.includes(action) && RESPONSE_ACTIONS.includes(action);
  }
}

function toResponse(row: ActionRow): ResponseActionResponse {
  return {
    id: row.id,
    appId: row.appId,
    subject: row.subject,
    action: row.action,
    reason: row.reason,
    status: row.status,
    alertId: row.alertId,
    requestedById: row.requestedById,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
