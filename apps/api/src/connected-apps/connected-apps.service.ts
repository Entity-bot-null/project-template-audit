import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SecretBox } from '../common/crypto/secret-box.js';
import { env } from '../env/env.js';
import { Prisma } from '../prisma/generated/client.js';
import { LOCK_NOT_AVAILABLE, rawQuerySqlState } from '../prisma/postgres-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AppDeletionProgress,
  ConnectedAppResponse,
  CreateConnectedAppDto,
  CreatedConnectedAppResponse,
  CredentialsResponse,
  UpdateConnectedAppDto,
} from './dto/connected-app.schemas.js';

/** How long a replaced signing key keeps verifying: time to redeploy with the new one. */
export const KEY_GRACE_MS = 7 * 24 * 3_600_000;
/** How long the previous webhook secret keeps signing (second signature). */
export const WEBHOOK_SECRET_GRACE_MS = 7 * 24 * 3_600_000;

/** Audit Hub's own application (its sign-ins, the use of its pages). */
export const SYSTEM_APP_ID = '00000000-0000-7000-8000-000000000001';

const KEY_SELECT = {
  id: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
} satisfies Prisma.AppKeySelect;

const APP_SELECT = {
  id: true,
  slug: true,
  name: true,
  environment: true,
  status: true,
  webhookUrl: true,
  correlationEnabled: true,
  acceptedResponseActions: true,
  requireActionApproval: true,
  heartbeatTimeoutSec: true,
  rateLimitPerMinute: true,
  createdAt: true,
  keys: { select: KEY_SELECT, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ConnectedAppSelect;

type AppRow = Prisma.ConnectedAppGetPayload<{ select: typeof APP_SELECT }>;

/** What the signature guard needs to verify one key's requests. */
export interface VerificationKey {
  appId: string;
  slug: string;
  status: Prisma.ConnectedAppGetPayload<{ select: { status: true } }>['status'];
  rateLimitPerMinute: number;
  key: Buffer;
}

/** Events per call of audit_delete_events, each its own short transaction. */
const DELETE_BATCH = 5000;

/** What one call of audit_delete_events did: deleted, kept by a hold, waiting for a seal. */
interface DeletedBatch {
  deleted: number;
  held: number;
  unsealed: number;
}

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

/** A ciphertext's context: the row and the column it belongs to. */
export const contexts = {
  key: (keyId: string) => `app_keys:${keyId}`,
  pseudonym: (appId: string) => `connected_apps:${appId}:pseudonym`,
  webhook: (appId: string) => `connected_apps:${appId}:webhook`,
  webhookPrevious: (appId: string) => `connected_apps:${appId}:webhook_previous`,
};

// Connected applications and their secrets (docs/adr/0006). A secret is 32
// random bytes, handed to the application once as base64url and kept here
// only sealed by the SecretBox.
@Injectable()
export class ConnectedAppsService {
  private readonly logger = new Logger('ConnectedApps');

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
  ) {}

  async create(
    actorId: string,
    input: CreateConnectedAppDto,
  ): Promise<CreatedConnectedAppResponse> {
    const id = await this.prisma.$transaction(async (tx) => {
      const taken = await tx.connectedApp.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      });
      if (taken !== null) throw new ConflictException('An application with this slug exists');
      const pseudonym = randomBytes(32);
      const app = await tx.connectedApp.create({
        data: {
          slug: input.slug,
          name: input.name,
          environment: input.environment,
          webhookUrl: input.webhookUrl ?? null,
          pseudonymKey: new Uint8Array(0),
          createdById: actorId,
        },
        select: { id: true },
      });
      // The context names the row, so the id must exist first.
      await tx.connectedApp.update({
        where: { id: app.id },
        data: { pseudonymKey: this.box.seal(pseudonym, contexts.pseudonym(app.id)).ciphertext },
      });
      return { id: app.id, pseudonym };
    });
    const key = await this.createKey(actorId, id.id);
    const webhookSecret = await this.newWebhookSecret(id.id, false);
    const app = await this.get(id.id);
    this.logger.log(`Connected application ${app.slug} (${app.id}) created by ${actorId}`);
    return {
      app,
      credentials: {
        variables: {
          AUDIT_HUB_URL: env.APP_ORIGIN ?? 'http://localhost:3200',
          AUDIT_HUB_APP: app.slug,
          AUDIT_HUB_KEY_ID: key.keyId,
          AUDIT_HUB_KEY_SECRET: key.keySecret,
          AUDIT_HUB_PSEUDONYM_KEY: id.pseudonym.toString('base64url'),
          AUDIT_HUB_WEBHOOK_SECRET: webhookSecret,
        },
      },
    };
  }

  async list(): Promise<ConnectedAppResponse[]> {
    const rows = await this.prisma.connectedApp.findMany({
      where: { system: false },
      select: APP_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async get(id: string): Promise<ConnectedAppResponse> {
    const row = await this.prisma.connectedApp.findFirst({
      where: { id, system: false },
      select: APP_SELECT,
    });
    if (row === null) throw new NotFoundException('Application not found');
    return toResponse(row);
  }

  async update(id: string, input: UpdateConnectedAppDto): Promise<ConnectedAppResponse> {
    const { count } = await this.prisma.connectedApp.updateMany({
      where: { id, system: false, status: { not: 'retired' } },
      data: input,
    });
    if (count === 0) {
      await this.get(id);
      throw new ConflictException('The application is retired: its log was deleted');
    }
    return this.get(id);
  }

  /**
   * The end of an application's service (docs/privacy/processor-contract.md):
   * its audit log deleted batch by batch for at most budgetMs, then, once
   * nothing is left, what Audit Hub derived from it, and the application
   * retired in the same transaction: its keys gone, its webhook secrets
   * cleared, its pseudonymization key replaced by one nobody knows. Only a
   * suspended application, only with its slug typed again, never what a
   * legal hold keeps (docs/adr/0007). Answers where it got to (call again
   * while deleting or waiting), and whether this call retired it.
   */
  async deleteLog(
    id: string,
    confirm: string,
    budgetMs = 10_000,
  ): Promise<{ progress: AppDeletionProgress; retired: boolean }> {
    const app = await this.prisma.connectedApp.findFirst({
      where: { id, system: false },
      select: { slug: true, status: true },
    });
    if (app === null) throw new NotFoundException('Application not found');
    if (app.status === 'retired') {
      return { progress: { status: 'deleted', deleted: 0, held: 0, waiting: 0 }, retired: false };
    }
    if (confirm !== app.slug) {
      throw new BadRequestException("confirm: type the application's slug to delete its log");
    }
    if (app.status !== 'suspended') {
      throw new ConflictException(
        'Suspend the application first: its log is deleted once ingestion stopped',
      );
    }
    const deadline = Date.now() + budgetMs;
    let deleted = 0;
    let last: DeletedBatch = { deleted: 0, held: 0, unsealed: 0 };
    let busy = false;
    do {
      const batch = await this.deleteBatch(id);
      if (batch === 'busy') {
        busy = true;
        break;
      }
      last = batch;
      deleted += last.deleted;
    } while (last.deleted === DELETE_BATCH && Date.now() < deadline);
    const counts = { deleted, held: last.held, waiting: last.unsealed };
    const stopped = (status: 'deleting' | 'waiting' | 'held') => ({
      progress: { status, ...counts },
      retired: false,
    });
    if (busy || last.deleted === DELETE_BATCH) return stopped('deleting');
    if (last.held > 0) return stopped('held');
    if (last.unsealed > 0) return stopped('waiting');
    const holds = await this.prisma.legalHold.count({
      where: { appId: id, release: { is: null } },
    });
    if (holds > 0) return stopped('held');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT audit_finish_application_deletion(${id}::uuid)`;
      await tx.connectedApp.update({
        where: { id },
        data: {
          status: 'retired',
          webhookUrl: null,
          webhookSecret: null,
          webhookSecretPrevious: null,
          webhookPreviousUntil: null,
          pseudonymKey: this.box.seal(randomBytes(32), contexts.pseudonym(id)).ciphertext,
        },
      });
    });
    this.logger.log(`Connected application ${app.slug} (${id}) retired: its audit log was deleted`);
    return { progress: { status: 'deleted', ...counts }, retired: true };
  }

  // One batch of the application's events; busy while another deletion of
  // them (another call, an erasure in the application) holds the database's
  // lock past 5 seconds.
  private async deleteBatch(id: string): Promise<DeletedBatch | 'busy'> {
    try {
      const [row] = await this.prisma.$queryRaw<DeletedBatch[]>`
        SELECT * FROM audit_delete_events(${id}::uuid, NULL, ${DELETE_BATCH})`;
      return row ?? { deleted: 0, held: 0, unsealed: 0 };
    } catch (error) {
      if (rawQuerySqlState(error) === LOCK_NOT_AVAILABLE) return 'busy';
      throw error;
    }
  }

  /** How many events the end of an application's service deleted in all (its runs). */
  async deletedEvents(id: string): Promise<number> {
    const { _sum } = await this.prisma.retentionRun.aggregate({
      where: { appId: id, trigger: 'decommission' },
      _sum: { deletedCount: true },
    });
    return _sum.deletedCount ?? 0;
  }

  /**
   * A new signing key. The key it replaces keeps verifying for KEY_GRACE_MS,
   * so the application can redeploy with the new one at leisure; at most two
   * keys are valid at once.
   */
  async createKey(actorId: string, appId: string): Promise<{ keyId: string; keySecret: string }> {
    const secret = randomBytes(32);
    const keyId = await this.prisma.$transaction(async (tx) => {
      await lockApp(tx, appId);
      const now = new Date();
      const valid = await tx.appKey.findMany({
        where: { appId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true, expiresAt: true },
      });
      if (valid.some((key) => key.expiresAt !== null)) {
        throw new ConflictException(
          'A replaced key is still valid: revoke it before creating another',
        );
      }
      await tx.appKey.updateMany({
        where: { id: { in: valid.map((key) => key.id) } },
        data: { expiresAt: new Date(now.getTime() + KEY_GRACE_MS) },
      });
      const created = await tx.appKey.create({
        data: {
          appId,
          secret: new Uint8Array(0),
          encKeyId: this.box.currentKeyId,
          createdById: actorId,
        },
        select: { id: true },
      });
      await tx.appKey.update({
        where: { id: created.id },
        data: { secret: this.box.seal(secret, contexts.key(created.id)).ciphertext },
      });
      return created.id;
    });
    return { keyId, keySecret: secret.toString('base64url') };
  }

  async revokeKey(appId: string, keyId: string): Promise<void> {
    const { count } = await this.prisma.appKey.updateMany({
      where: { id: keyId, appId, revokedAt: null, app: { system: false } },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Key not found');
  }

  /** A new webhook secret; the previous one keeps signing for WEBHOOK_SECRET_GRACE_MS. */
  async rotateWebhookSecret(appId: string): Promise<CredentialsResponse> {
    await this.get(appId);
    return { variables: { AUDIT_HUB_WEBHOOK_SECRET: await this.newWebhookSecret(appId, true) } };
  }

  private async newWebhookSecret(appId: string, keepPrevious: boolean): Promise<string> {
    const secret = randomBytes(32);
    await this.prisma.$transaction(async (tx) => {
      const current = await lockApp(tx, appId);
      const previous =
        keepPrevious && current.webhookSecret !== null
          ? this.box.seal(
              this.box.open(current.webhookSecret, contexts.webhook(appId)),
              contexts.webhookPrevious(appId),
            ).ciphertext
          : null;
      await tx.connectedApp.update({
        where: { id: appId },
        data: {
          webhookSecret: this.box.seal(secret, contexts.webhook(appId)).ciphertext,
          webhookSecretPrevious: previous,
          webhookPreviousUntil:
            previous === null ? null : new Date(Date.now() + WEBHOOK_SECRET_GRACE_MS),
        },
      });
    });
    return secret.toString('base64url');
  }

  /** The key a signed request names, if it may still be used. */
  async verificationKey(
    keyId: string,
    now: Date = new Date(),
  ): Promise<VerificationKey | undefined> {
    const row = await this.prisma.appKey.findFirst({
      where: {
        id: keyId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        app: { system: false },
      },
      select: {
        secret: true,
        lastUsedAt: true,
        app: { select: { id: true, slug: true, status: true, rateLimitPerMinute: true } },
      },
    });
    if (row === null) return undefined;
    if (row.lastUsedAt === null || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
      // Bookkeeping only: never fails the request.
      this.prisma.appKey
        .update({ where: { id: keyId }, data: { lastUsedAt: now } })
        .catch(() => undefined);
    }
    return {
      appId: row.app.id,
      slug: row.app.slug,
      status: row.app.status,
      rateLimitPerMinute: row.app.rateLimitPerMinute,
      key: this.box.open(row.secret, contexts.key(keyId)),
    };
  }

  /** The keys webhooks to this application are signed with: current, then previous. */
  async webhookTarget(
    appId: string,
    now: Date = new Date(),
  ): Promise<{ slug: string; url: string; keys: Buffer[] } | undefined> {
    const row = await this.prisma.connectedApp.findFirst({
      where: { id: appId, system: false },
      select: {
        slug: true,
        webhookUrl: true,
        webhookSecret: true,
        webhookSecretPrevious: true,
        webhookPreviousUntil: true,
      },
    });
    if (row?.webhookUrl === null || row?.webhookUrl === undefined || row.webhookSecret === null) {
      return undefined;
    }
    const keys = [this.box.open(row.webhookSecret, contexts.webhook(appId))];
    if (row.webhookSecretPrevious !== null && (row.webhookPreviousUntil ?? now) > now) {
      keys.push(this.box.open(row.webhookSecretPrevious, contexts.webhookPrevious(appId)));
    }
    return { slug: row.slug, url: row.webhookUrl, keys };
  }

  /** The application's pseudonymization key (emails are searched by their HMAC). */
  async pseudonymKey(appId: string): Promise<Buffer> {
    const row = await this.prisma.connectedApp.findUnique({
      where: { id: appId },
      select: { pseudonymKey: true },
    });
    if (row === null) throw new NotFoundException('Application not found');
    return this.box.open(row.pseudonymKey, contexts.pseudonym(appId));
  }

  /**
   * Audit Hub's own application row, created by the migration and again here
   * when it is missing (the test suites empty every table), with its
   * pseudonymization key set the first time.
   */
  async ensureSystemApp(): Promise<void> {
    const row = await this.prisma.connectedApp.findUnique({
      where: { id: SYSTEM_APP_ID },
      select: { pseudonymKey: true },
    });
    if (row !== null && row.pseudonymKey.length > 0) return;
    const sealed = this.box.seal(randomBytes(32), contexts.pseudonym(SYSTEM_APP_ID)).ciphertext;
    await this.prisma.connectedApp.upsert({
      where: { id: SYSTEM_APP_ID },
      create: {
        id: SYSTEM_APP_ID,
        slug: 'audit-hub',
        name: 'Audit Hub',
        environment: 'self',
        system: true,
        pseudonymKey: sealed,
      },
      update: { pseudonymKey: sealed },
    });
  }
}

/** Serializes key and secret changes of one application (the row lock). */
async function lockApp(tx: Prisma.TransactionClient, appId: string) {
  const rows = await tx.$queryRaw<{ webhookSecret: Uint8Array | null }[]>`
    SELECT "webhook_secret" AS "webhookSecret" FROM "connected_apps"
    WHERE "id" = ${appId}::uuid AND NOT "system" FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundException('Application not found');
  return { webhookSecret: row.webhookSecret };
}

function toResponse(row: AppRow): ConnectedAppResponse {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    environment: row.environment,
    status: row.status,
    webhookUrl: row.webhookUrl,
    correlationEnabled: row.correlationEnabled,
    acceptedResponseActions: row.acceptedResponseActions,
    requireActionApproval: row.requireActionApproval,
    heartbeatTimeoutSec: row.heartbeatTimeoutSec,
    rateLimitPerMinute: row.rateLimitPerMinute,
    createdAt: row.createdAt.toISOString(),
    keys: row.keys.map((key) => ({
      id: key.id,
      createdAt: key.createdAt.toISOString(),
      expiresAt: iso(key.expiresAt),
      revokedAt: iso(key.revokedAt),
      lastUsedAt: iso(key.lastUsedAt),
    })),
  };
}
