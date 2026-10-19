import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import { PROMPT_TTL_MS } from './audit.constants.js';
import type { AuditHandlers, SecurityPrompt } from './audit.ports.js';
import { AuditService } from './audit.service.js';
import { MemoryStore, TEST_CONFIG, TEST_TX } from './audit.testing.js';
import { nodeRandomFill, uuidv7 } from './contract/index.js';
import type { AuditTx } from './host.js';
import { SecurityPromptsService } from './security-prompts.service.js';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
let now = NOW;
const clock = () => now;

function setup(handlers: AuditHandlers = {}, config: AuditConfig | null = TEST_CONFIG) {
  const store = new MemoryStore();
  store.now = clock;
  store.users.add('user-2');
  const audit = new AuditService(config, store, clock);
  const service = new SecurityPromptsService(config, store, handlers, clock, audit);
  return { store, service };
}

/** A prompt as the webhook stores it. */
async function prompt(
  store: MemoryStore,
  userId = 'user-1',
  expiresAt = new Date(now + PROMPT_TTL_MS),
): Promise<SecurityPrompt> {
  const saved = await store.savePrompt(TEST_TX, {
    userId,
    webhookId: randomUUID(),
    hubEventId: uuidv7(nodeRandomFill, now),
    signals: ['new_device', 'new_country'],
    context: { country: 'MX', city: 'Monterrey', clientType: 'ios' },
    expiresAt,
  });
  if (saved === null) throw new Error('The prompt was not stored');
  return saved;
}

function viewOf(saved: SecurityPrompt) {
  return {
    id: saved.id,
    signals: ['new_device', 'new_country'],
    context: { country: 'MX', city: 'Monterrey', clientType: 'ios' },
    createdAt: saved.createdAt.toISOString(),
    expiresAt: saved.expiresAt.toISOString(),
  };
}

beforeEach(() => {
  now = NOW;
});

describe('SecurityPromptsService', () => {
  it('answers 404 while the connector is off', async () => {
    const { store, service } = setup({}, null);
    const open = await prompt(store);

    await expect(service.open('user-1')).rejects.toThrow(NotFoundException);
    await expect(service.answer('user-1', open.id, 'confirmed')).rejects.toThrow(NotFoundException);
    expect(store.prompts[0]?.answer).toBeNull();
  });

  it("lists only the user's open prompts, without Audit Hub's ids", async () => {
    const { store, service } = setup();
    const open = await prompt(store);
    await prompt(store, 'user-1', new Date(now - 1));
    const answered = await prompt(store);
    await store.answerPrompt(TEST_TX, 'user-1', answered.id, 'confirmed', new Date(now));
    await prompt(store, 'user-2');

    await expect(service.open('user-1')).resolves.toEqual([viewOf(open)]);
  });

  describe('answering', () => {
    it.each(['missing', 'expired', 'answered', "another user's"] as const)(
      'answers 404 for a prompt %s, recording nothing',
      async (kind) => {
        const { store, service } = setup();
        const target =
          kind === 'missing'
            ? randomUUID()
            : kind === 'expired'
              ? (await prompt(store, 'user-1', new Date(now - 1))).id
              : kind === 'answered'
                ? (await prompt(store)).id
                : (await prompt(store, 'user-2')).id;
        if (kind === 'answered') {
          await store.answerPrompt(TEST_TX, 'user-1', target, 'confirmed', new Date(now));
        }

        await expect(service.answer('user-1', target, 'not_me')).rejects.toThrow(
          new NotFoundException('Security prompt not found'),
        );
        expect(store.rows).toEqual([]);
      },
    );

    it('records a confirmation as an event of the default severity', async () => {
      let notMe = 0;
      const { store, service } = setup({
        onNotMe: () => {
          notMe += 1;
          return Promise.resolve();
        },
      });
      const open = await prompt(store);
      now += 60_000;

      const answer = await service.answer('user-1', open.id, 'confirmed');

      expect(answer).toEqual({ ...viewOf(open), answer: 'confirmed' });
      expect(store.prompts[0]).toMatchObject({ answer: 'confirmed', answeredAt: new Date(now) });
      expect(store.rows).toHaveLength(1);
      const draft = store.rows[0]?.draft;
      expect(draft).toMatchObject({
        action: 'account.security_prompt.answered',
        outcome: 'success',
        actor: { type: 'user', id: 'user-1' },
        details: { answer: 'confirmed' },
      });
      expect(draft).not.toHaveProperty('severity');
      expect(notMe).toBe(0);
    });

    it('records "not me" as high severity and runs onNotMe in the transaction', async () => {
      const calls: { tx: AuditTx; userId: string; queued: number }[] = [];
      const { store, service } = setup({
        onNotMe: (tx, userId) => {
          calls.push({ tx, userId, queued: store.rows.length });
          return Promise.resolve();
        },
      });
      const open = await prompt(store);

      const answer = await service.answer('user-1', open.id, 'not_me');

      expect(answer).toEqual({ ...viewOf(open), answer: 'not_me' });
      expect(calls).toEqual([{ tx: TEST_TX, userId: 'user-1', queued: 1 }]);
      expect(store.rows[0]?.draft).toMatchObject({
        action: 'account.security_prompt.answered',
        severity: 'high',
        details: { answer: 'not_me' },
      });
    });

    it('records "not me" without onNotMe', async () => {
      const { store, service } = setup();
      const open = await prompt(store);

      await expect(service.answer('user-1', open.id, 'not_me')).resolves.toMatchObject({
        answer: 'not_me',
      });
      expect(store.rows).toHaveLength(1);
    });

    it('rolls everything back when onNotMe fails, so the prompt can be answered again', async () => {
      let failing = true;
      const { store, service } = setup({
        onNotMe: () =>
          failing ? Promise.reject(new Error('sessions table locked')) : Promise.resolve(),
      });
      const open = await prompt(store);

      await expect(service.answer('user-1', open.id, 'not_me')).rejects.toThrow(
        'sessions table locked',
      );

      expect(store.prompts[0]?.answer).toBeNull();
      expect(store.rows).toEqual([]);
      await expect(service.open('user-1')).resolves.toEqual([viewOf(open)]);

      failing = false;
      await expect(service.answer('user-1', open.id, 'not_me')).resolves.toMatchObject({
        answer: 'not_me',
      });
      expect(store.rows).toHaveLength(1);
    });
  });
});
