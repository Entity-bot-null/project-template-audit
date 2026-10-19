import { z } from 'zod';
import { TimestampSchema } from './event.js';
import { EXPO_PUSH_TOKEN_PATTERN } from './patterns.js';

// The routes a connector adds to its project's API for the signed-in person
// (docs/audit/connection-guide.md): "Was it you?" and the phone's push token.
// The API answers with these schemas and its apps read them with the same
// ones. Answers are read leniently (z.object): a field added by a newer API
// never breaks an older app.

export const PROMPT_ANSWERS = ['confirmed', 'not_me'] as const;
export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PromptAnswer = (typeof PROMPT_ANSWERS)[number];
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** The app's screen of a "Was it you?" prompt: the path its push notification opens. */
export const SECURITY_PROMPT_PATH = '/security/prompts/';

export function securityPromptPath(id: string): string {
  return `${SECURITY_PROMPT_PATH}${id}`;
}

/** An open "Was it you?" question about a sign-in of the person's account. */
export const SecurityPromptSchema = z.object({
  id: z.uuid(),
  /** Why the sign-in looked suspicious: new_device, impossible_travel… */
  signals: z.array(z.string()),
  /** Where and on what it happened, as Audit Hub saw it: country, city, clientType, deviceModel. */
  context: z.record(z.string(), z.string()),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
});
export type SecurityPrompt = z.infer<typeof SecurityPromptSchema>;

export const SecurityPromptListSchema = z.object({ items: z.array(SecurityPromptSchema) });

/** POST /api/account/security-prompts/:id/answer */
export const SecurityPromptAnswerSchema = z.strictObject({ answer: z.enum(PROMPT_ANSWERS) });

export const AnsweredSecurityPromptSchema = SecurityPromptSchema.extend({
  answer: z.enum(PROMPT_ANSWERS),
});
export type AnsweredSecurityPrompt = z.infer<typeof AnsweredSecurityPromptSchema>;

/** PUT /api/account/push-token: the phone's Expo push token, after each sign-in. */
export const PushTokenSchema = z.strictObject({
  token: z.string().max(255).regex(EXPO_PUSH_TOKEN_PATTERN),
  platform: z.enum(PUSH_PLATFORMS),
});

/** DELETE /api/account/push-token: at sign-out, so the next person on the phone gets none of it. */
export const PushTokenDeleteSchema = z.strictObject({
  token: z.string().max(255).regex(EXPO_PUSH_TOKEN_PATTERN),
});
