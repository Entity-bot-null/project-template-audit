import { ConsoleLogger, Logger, type LoggerService, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditConfig } from './audit-env.js';
import type { AuditHandlers, SecurityPrompt } from './audit.ports.js';
import { FakePushSender, MemoryStore, TEST_CONFIG, TEST_PUSH_CONFIG } from './audit.testing.js';
import { PushService } from './push.service.js';

const ANA = { id: 'user-1', role: 'member' } as const;
const LUIS = { id: 'user-2', role: 'member' } as const;
const PHONE = 'ExponentPushToken[phone-of-ana-1]';

/** Nest's logger, recorded: the service logs a push it could not send. */
class RecordingLogger implements LoggerService {
  readonly warnings: unknown[] = [];
  log(): void {
    // Not asserted.
  }
  error(): void {
    // Not asserted.
  }
  warn(message: unknown): void {
    this.warnings.push(message);
  }
}

let logger: RecordingLogger;

beforeEach(() => {
  logger = new RecordingLogger();
  Logger.overrideLogger(logger);
});

afterEach(() => {
  Logger.overrideLogger(new ConsoleLogger());
});

function setup(
  config: AuditConfig | null = TEST_PUSH_CONFIG,
  sender: FakePushSender | null = new FakePushSender(),
  handlers: AuditHandlers = {},
) {
  const store = new MemoryStore();
  return { store, sender, service: new PushService(config, store, sender, handlers) };
}

function prompt(userId = ANA.id): SecurityPrompt {
  return {
    id: '0199f0c4-0000-7000-8000-00000000a001',
    userId,
    hubEventId: '0199f0c4-0000-7000-8000-00000000b001',
    signals: ['new_device'],
    context: { clientType: 'android' },
    expiresAt: new Date(Date.UTC(2026, 9, 24)),
    answer: null,
    answeredAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 17)),
  };
}

describe('PushService', () => {
  it('answers 404 and pushes nothing while the push module or the connector is off', async () => {
    for (const { config, sender } of [
      { config: TEST_CONFIG, sender: new FakePushSender() },
      { config: null, sender: new FakePushSender() },
      { config: TEST_PUSH_CONFIG, sender: null },
    ]) {
      const { store, service } = setup(config, sender);
      store.pushTokens.set(PHONE, { userId: ANA.id, platform: 'ios' });
      expect(service.enabled).toBe(false);
      await expect(service.register(ANA, { token: PHONE, platform: 'ios' })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.unregister(ANA, { token: PHONE })).rejects.toThrow(NotFoundException);
      await expect(service.notifyPrompt(prompt())).resolves.toBe(0);
      expect(sender?.sent ?? []).toEqual([]);
    }
  });

  it("registers a phone's token, and gives it to whoever signs in on that phone next", async () => {
    const { store, service } = setup();

    await service.register(ANA, { token: PHONE, platform: 'ios' });
    expect(await store.pushTokensOf(ANA.id)).toEqual([PHONE]);

    await service.register(LUIS, { token: PHONE, platform: 'ios' });
    expect(await store.pushTokensOf(ANA.id)).toEqual([]);
    expect(await store.pushTokensOf(LUIS.id)).toEqual([PHONE]);
  });

  it("forgets the user's own token at sign-out, and nobody else's", async () => {
    const { store, service } = setup();
    await service.register(ANA, { token: PHONE, platform: 'ios' });

    await service.unregister(LUIS, { token: PHONE });
    expect(await store.pushTokensOf(ANA.id)).toEqual([PHONE]);

    await service.unregister(ANA, { token: PHONE });
    await service.unregister(ANA, { token: PHONE });
    expect(await store.pushTokensOf(ANA.id)).toEqual([]);
  });

  it("pushes a prompt to each of the user's phones, opening its screen", async () => {
    const { store, sender, service } = setup();
    store.pushTokens.set(PHONE, { userId: ANA.id, platform: 'ios' });
    store.pushTokens.set('ExponentPushToken[tablet-of-ana]', {
      userId: ANA.id,
      platform: 'android',
    });
    store.pushTokens.set('ExponentPushToken[phone-of-luis]', { userId: LUIS.id, platform: 'ios' });

    await expect(service.notifyPrompt(prompt())).resolves.toBe(2);

    expect(sender?.sent).toEqual([
      {
        tokens: [PHONE, 'ExponentPushToken[tablet-of-ana]'],
        message: {
          title: 'Was it you?',
          body: 'Someone signed in to your account. Open the app to answer.',
          url: '/security/prompts/0199f0c4-0000-7000-8000-00000000a001',
        },
      },
    ]);
  });

  it("says it in the project's words, never with anything but the screen to open", async () => {
    const { store, sender, service } = setup(TEST_PUSH_CONFIG, new FakePushSender(), {
      promptPush: () => ({ title: '¿Fuiste tú?', body: 'Abre la app para responder.' }),
    });
    store.pushTokens.set(PHONE, { userId: ANA.id, platform: 'ios' });

    await service.notifyPrompt(prompt());

    expect(sender?.sent[0]?.message).toEqual({
      title: '¿Fuiste tú?',
      body: 'Abre la app para responder.',
      url: '/security/prompts/0199f0c4-0000-7000-8000-00000000a001',
    });
  });

  it('sends a hundred phones a request, and forgets those the push service no longer knows', async () => {
    const tokens = Array.from({ length: 150 }, (_, n) => `ExponentPushToken[phone-${String(n)}]`);
    const gone = new Set([tokens[3], tokens[120]]);
    const sender = new FakePushSender((batch) => ({
      unregistered: batch.filter((token) => gone.has(token)),
    }));
    const { store, service } = setup(TEST_PUSH_CONFIG, sender);
    for (const token of tokens) store.pushTokens.set(token, { userId: ANA.id, platform: 'ios' });

    await expect(service.notifyPrompt(prompt())).resolves.toBe(148);

    expect(sender.sent.map((push) => push.tokens.length)).toEqual([100, 50]);
    expect(await store.pushTokensOf(ANA.id)).toHaveLength(148);
  });

  it('logs a push it could not send, without throwing: the prompt is there anyway', async () => {
    const sender = new FakePushSender(() => {
      throw new Error('push service down');
    });
    const { store, service } = setup(TEST_PUSH_CONFIG, sender);
    store.pushTokens.set(PHONE, { userId: ANA.id, platform: 'ios' });

    await expect(service.notifyPrompt(prompt())).resolves.toBe(0);
    expect(logger.warnings).toEqual([
      'Could not push prompt 0199f0c4-0000-7000-8000-00000000a001: push service down',
    ]);
  });

  it('pushes nothing to a user without a registered phone', async () => {
    const { sender, service } = setup();
    await expect(service.notifyPrompt(prompt())).resolves.toBe(0);
    expect(sender?.sent).toEqual([]);
  });
});
