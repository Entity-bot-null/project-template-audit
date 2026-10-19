import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditConfig } from './audit-env.js';
import { AUDIT_CLOCK, AUDIT_CONFIG, AUDIT_HANDLERS, AUDIT_STORE } from './audit.constants.js';
import type { AuditHandlers, AuditStore, PromptAnswer, SecurityPrompt } from './audit.ports.js';
import { AuditService } from './audit.service.js';

/** A prompt as the user's app shows it: no ids of Audit Hub, no addresses. */
export interface PromptView {
  id: string;
  signals: string[];
  context: Record<string, string>;
  createdAt: string;
  expiresAt: string;
}

const viewOf = (prompt: SecurityPrompt): PromptView => ({
  id: prompt.id,
  signals: prompt.signals,
  context: prompt.context,
  createdAt: prompt.createdAt.toISOString(),
  expiresAt: prompt.expiresAt.toISOString(),
});

/**
 * "Was it you?": the sign-ins Audit Hub found suspicious, for the user they
 * are about. Answering "not me" runs the project's onNotMe (end the
 * sessions) in the answer's transaction; every answer is an event.
 */
@Injectable()
export class SecurityPromptsService {
  constructor(
    @Inject(AUDIT_CONFIG) private readonly config: AuditConfig | null,
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(AUDIT_HANDLERS) private readonly handlers: AuditHandlers,
    @Inject(AUDIT_CLOCK) private readonly clock: () => number,
    private readonly audit: AuditService,
  ) {}

  async open(userId: string): Promise<PromptView[]> {
    if (this.config === null) throw new NotFoundException('Not found');
    return (await this.store.openPrompts(userId, new Date(this.clock()))).map(viewOf);
  }

  async answer(
    userId: string,
    id: string,
    answer: PromptAnswer,
  ): Promise<PromptView & { answer: PromptAnswer }> {
    if (this.config === null) throw new NotFoundException('Not found');
    return this.store.transaction(async (tx) => {
      const prompt = await this.store.answerPrompt(tx, userId, id, answer, new Date(this.clock()));
      if (prompt === null) throw new NotFoundException('Security prompt not found');
      await this.audit.record(tx, {
        action: 'account.security_prompt.answered',
        ...(answer === 'not_me' ? { severity: 'high' as const } : {}),
        actor: { type: 'user', id: userId },
        details: { answer },
      });
      if (answer === 'not_me') await this.handlers.onNotMe?.(tx, userId);
      return { ...viewOf(prompt), answer };
    });
  }
}
