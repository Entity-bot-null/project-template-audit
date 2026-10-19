import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CLOCK,
  AUDIT_CONFIG,
  AUDIT_HANDLERS,
  AUDIT_STORE,
  PROMPT_TTL_MS,
} from './audit.constants.js';
import type { AuditHandlers, AuditStore, SecurityPrompt } from './audit.ports.js';
import { AuditService } from './audit.service.js';
import { PushService } from './push.service.js';
import {
  bodyDigest,
  parseSignatureHeader,
  parseTimestamp,
  type ResponseActionRequestedDataSchema,
  safeEqual,
  secretKey,
  SIGNATURE_HEADERS,
  SIGNATURE_WINDOW_SEC,
  isFresh,
  verifySignature,
  WebhookEnvelopeSchema,
  WebhookSchema,
} from './contract/index.js';
import type { AuditTx } from './host.js';
import type { z } from 'zod';

export type WebhookStatus = 'accepted' | 'refused' | 'unsupported';
type ActionRequest = z.infer<typeof ResponseActionRequestedDataSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Audit Hub's webhooks (docs/design/audit-hub/contract.md#webhooks): verified
 * (the signature over the canonical body, within five minutes), handled once
 * per delivery id, each in one transaction with its outcome. An unknown
 * type is answered `unsupported`, so a newer Audit Hub breaks nothing.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('AuditWebhooks');

  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_HANDLERS) private readonly handlers: AuditHandlers,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  async receive(req: Request): Promise<WebhookStatus> {
    const config = this.config;
    if (config === null || config.webhookSecrets.length === 0)
      throw new NotFoundException('Not found');
    const id = this.verify(req, config);
    const envelope = WebhookEnvelopeSchema.safeParse(req.body);
    if (!envelope.success) throw new BadRequestException('Not a webhook of Audit Hub');
    if (envelope.data.id !== id) throw new UnauthorizedException('Invalid webhook signature');
    const webhook = WebhookSchema.safeParse(req.body);
    if (!webhook.success) {
      this.logger.warn(`Webhook ${envelope.data.type} not understood: answered unsupported`);
      return 'unsupported';
    }
    const after: (() => Promise<void>)[] = [];
    const status = await this.store.transaction(async (tx) => {
      if (!(await this.store.firstReceipt(tx, id, webhook.data.type))) return 'accepted';
      switch (webhook.data.type) {
        case 'ping':
          return 'accepted';
        case 'alert.created': {
          const alert = webhook.data.data;
          if (this.handlers.onAlert !== undefined) {
            const onAlert = this.handlers.onAlert;
            after.push(() => onAlert(alert));
          }
          return 'accepted';
        }
        case 'security.sign_in_suspicious': {
          const data = webhook.data.data;
          const prompt = await this.store.savePrompt(tx, {
            userId: data.subject,
            webhookId: id,
            hubEventId: data.eventId,
            signals: [...data.signals],
            context: Object.fromEntries(Object.entries(data.context)),
            expiresAt: new Date(this.clock() + PROMPT_TTL_MS),
          });
          if (prompt !== null) {
            // Pushed to the user's phones once it is stored (the push module).
            after.push(async () => {
              await this.push.notifyPrompt(prompt);
            });
            if (this.handlers.onSecurityPrompt !== undefined) {
              const onPrompt = this.handlers.onSecurityPrompt;
              after.push(() => onPrompt(prompt));
            }
          }
          return 'accepted';
        }
        case 'response_action.requested':
          return this.respond(tx, webhook.data.data, config);
      }
    });
    for (const work of after) {
      // Committed already: a failing hook (a push) is logged, the delivery stays handled.
      await work().catch((error: unknown) => {
        this.logger.error(
          `Webhook ${id} follow-up failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return status;
  }

  /** A response action: run by the project's handler, its outcome recorded in the same transaction. */
  private async respond(
    tx: AuditTx,
    data: ActionRequest,
    config: AuditConfig,
  ): Promise<WebhookStatus> {
    const handler = this.handlers.responseActions?.[data.action];
    let result: 'succeeded' | 'failed' | 'refused' | 'unsupported';
    if (!config.responseActions.includes(data.action) || handler === undefined) {
      result = 'unsupported';
    } else if (Date.parse(data.expiresAt) <= this.clock()) {
      result = 'refused';
    } else {
      result = await handler(tx, data.subject);
    }
    await this.audit.record(tx, {
      action: 'audit.response_action.executed',
      outcome: result === 'succeeded' ? 'success' : 'failure',
      actor: { type: 'service', id: 'audit-hub' },
      resource: { type: 'user', id: data.subject },
      details: { actionId: data.actionId, action: data.action, result },
    });
    this.logger.log(`Response action ${data.action} ${data.actionId}: ${result}`);
    return result === 'succeeded'
      ? 'accepted'
      : result === 'unsupported'
        ? 'unsupported'
        : 'refused';
  }

  /** The delivery id, once the signature is right; 401 otherwise (Audit Hub does not retry it). */
  private verify(req: Request, config: AuditConfig): string {
    const header = (name: string) => req.get(name);
    const id = header(SIGNATURE_HEADERS.webhookId);
    const timestamp = parseTimestamp(header(SIGNATURE_HEADERS.timestamp));
    const digest = header(SIGNATURE_HEADERS.bodyDigest);
    const signatures = parseSignatureHeader(header(SIGNATURE_HEADERS.signature));
    if (
      id === undefined ||
      !UUID.test(id) ||
      timestamp === undefined ||
      !isFresh(timestamp, this.clock(), SIGNATURE_WINDOW_SEC) ||
      digest === undefined ||
      signatures.length === 0 ||
      !safeEqual(bodyDigest(req.body as unknown), digest)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const valid = verifySignature(
      config.webhookSecrets.map((secret) => secretKey(secret)),
      {
        method: 'POST',
        path: req.originalUrl.split('?', 1)[0] ?? req.originalUrl,
        query: '',
        timestamp,
        nonce: id,
        keyId: config.app,
        bodyDigest: digest,
      },
      signatures,
    );
    if (!valid) throw new UnauthorizedException('Invalid webhook signature');
    return id;
  }
}

export type { SecurityPrompt };
