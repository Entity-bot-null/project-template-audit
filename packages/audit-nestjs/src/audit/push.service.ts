import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type { AuditConfig } from './audit-env.js';
import {
  AUDIT_CONFIG,
  AUDIT_HANDLERS,
  AUDIT_PUSH,
  AUDIT_STORE,
  PUSH_BATCH,
} from './audit.constants.js';
import type {
  AuditHandlers,
  AuditPushSender,
  AuditStore,
  PushMessage,
  SecurityPrompt,
} from './audit.ports.js';
import {
  type PushTokenDeleteSchema,
  type PushTokenSchema,
  securityPromptPath,
} from './contract/index.js';
import type { RequestUser } from './host.js';

/** PUT /api/account/push-token (the contract's PushTokenSchema), from the app. */
export type PushTokenBody = z.infer<typeof PushTokenSchema>;
/** DELETE /api/account/push-token, at sign-out. */
export type PushTokenDeleteBody = z.infer<typeof PushTokenDeleteSchema>;

/** The push of a prompt when the project has no words of its own (AuditHandlers.promptPush). */
const PROMPT_PUSH = {
  title: 'Was it you?',
  body: 'Someone signed in to your account. Open the app to answer.',
};

/**
 * The push module (docs/adr/0013): with AUDIT_HUB_PUSH=expo, the app registers
 * each phone's push token after a sign-in and removes it at sign-out, and a
 * "Was it you?" prompt is pushed to the user's phones. The push carries only
 * the screen it opens (`data.url`), never an action: the user answers there.
 * Off (no variable, or the connector off), its routes answer 404 and nothing
 * is pushed; the prompt still appears in the app.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('AuditPush');

  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_PUSH) private readonly sender: AuditPushSender | null,
    @Inject(AUDIT_HANDLERS) private readonly handlers: AuditHandlers,
  ) {}

  get enabled(): boolean {
    return this.config?.push != null && this.sender !== null;
  }

  async register(user: RequestUser, body: PushTokenBody): Promise<void> {
    if (!this.enabled) throw new NotFoundException('Not found');
    await this.store.savePushToken(user.id, body.token, body.platform);
  }

  /** Idempotent: a token that is not the user's (or gone) answers the same. */
  async unregister(user: RequestUser, body: PushTokenDeleteBody): Promise<void> {
    if (!this.enabled) throw new NotFoundException('Not found');
    await this.store.deletePushToken(user.id, body.token);
  }

  /**
   * "Was it you?" on each phone of the prompt's user; tokens the push service
   * no longer knows are forgotten. Never throws: the prompt is stored either
   * way, and a failure is logged. Answers how many phones it was sent to.
   */
  async notifyPrompt(prompt: SecurityPrompt): Promise<number> {
    if (!this.enabled || this.sender === null) return 0;
    const sender = this.sender;
    try {
      const tokens = await this.store.pushTokensOf(prompt.userId);
      const message: PushMessage = {
        ...(this.handlers.promptPush?.(prompt) ?? PROMPT_PUSH),
        url: securityPromptPath(prompt.id),
      };
      let sent = 0;
      for (let start = 0; start < tokens.length; start += PUSH_BATCH) {
        const batch = tokens.slice(start, start + PUSH_BATCH);
        const { unregistered } = await sender.send(batch, message);
        if (unregistered.length > 0) await this.store.forgetPushTokens(unregistered);
        sent += batch.length - unregistered.length;
      }
      return sent;
    } catch (error) {
      this.logger.warn(
        `Could not push prompt ${prompt.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
