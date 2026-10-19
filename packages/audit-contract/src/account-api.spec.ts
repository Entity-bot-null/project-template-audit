import { describe, expect, it } from 'vitest';
import {
  AnsweredSecurityPromptSchema,
  PushTokenDeleteSchema,
  PushTokenSchema,
  SecurityPromptAnswerSchema,
  SecurityPromptListSchema,
  securityPromptPath,
} from './account-api.js';

const PROMPT = {
  id: '0199f0c4-0000-7000-8000-00000000a001',
  signals: ['new_device', 'impossible_travel'],
  context: { clientType: 'android', country: 'MX', city: 'Guadalajara' },
  createdAt: '2026-10-17T12:00:00.000Z',
  expiresAt: '2026-10-24T12:00:00.000Z',
};
const PHONE = 'ExponentPushToken[phone-of-ana-1]';

describe('"Was it you?"', () => {
  it('reads the open prompts, and tolerates fields a newer API adds', () => {
    expect(SecurityPromptListSchema.parse({ items: [PROMPT] })).toEqual({ items: [PROMPT] });
    expect(
      SecurityPromptListSchema.safeParse({ items: [{ ...PROMPT, severity: 'high' }] }).success,
    ).toBe(true);
    for (const wrong of [
      { ...PROMPT, id: 'prompt-1' },
      { ...PROMPT, expiresAt: 'next week' },
      { ...PROMPT, context: { clientType: 3 } },
    ]) {
      expect(SecurityPromptListSchema.safeParse({ items: [wrong] }).success).toBe(false);
    }
  });

  it('takes one of two answers, and reads the answered prompt', () => {
    expect(SecurityPromptAnswerSchema.safeParse({ answer: 'not_me' }).success).toBe(true);
    expect(SecurityPromptAnswerSchema.safeParse({ answer: 'confirmed' }).success).toBe(true);
    expect(SecurityPromptAnswerSchema.safeParse({ answer: 'maybe' }).success).toBe(false);
    expect(SecurityPromptAnswerSchema.safeParse({ answer: 'not_me', at: 1 }).success).toBe(false);
    expect(AnsweredSecurityPromptSchema.parse({ ...PROMPT, answer: 'confirmed' }).answer).toBe(
      'confirmed',
    );
  });

  it("opens the prompt's own screen", () => {
    expect(securityPromptPath(PROMPT.id)).toBe(`/security/prompts/${PROMPT.id}`);
  });
});

describe('push tokens', () => {
  it("accept an Expo push token and the phone's platform only", () => {
    expect(PushTokenSchema.safeParse({ token: PHONE, platform: 'ios' }).success).toBe(true);
    expect(
      PushTokenSchema.safeParse({ token: 'ExpoPushToken[abc_DEF-123]', platform: 'android' })
        .success,
    ).toBe(true);
    for (const body of [
      { token: 'a1b2c3d4e5f6', platform: 'ios' }, // a device token: Expo's service cannot use it
      { token: PHONE, platform: 'web' },
      { token: PHONE },
      { token: `ExponentPushToken[${'x'.repeat(260)}]`, platform: 'ios' },
      { token: PHONE, platform: 'ios', extra: true },
    ]) {
      expect(PushTokenSchema.safeParse(body).success).toBe(false);
    }
    expect(PushTokenDeleteSchema.safeParse({ token: PHONE }).success).toBe(true);
    expect(PushTokenDeleteSchema.safeParse({ token: 'nope' }).success).toBe(false);
  });
});
