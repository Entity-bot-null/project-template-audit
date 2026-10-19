import type { AuditTransport } from '@/lib/audit/audit.ports';
import {
  ActivityPageSchema,
  AnsweredSecurityPromptSchema,
  ClientEventBatchResultSchema,
  SecurityPromptListSchema,
} from '@/lib/audit/contract';
import { toAppError } from '@/lib/errors';

import { api } from './client';
import { errorFromResponse, unwrapWith } from './unwrap';

// The routes the API's Audit Hub connector adds (Audit Hub's
// docs/audit/connection-guide.md), through the app's one client: the
// session's token, the timeout, the request id and the device's headers
// come with every call. Created once by `pnpm connector add --kind expo`;
// the project's own code from then on.

/** Failures with no answer at all: the events wait for the next chance. */
const NO_ANSWER = new Set(['network', 'timeout', 'cancelled']);
/** The session could not be renewed for now (src/auth/session.ts): not the events' fault. */
const NOT_NOW = new Set(['server', 'rateLimited']);

/** Retry-After, in seconds or as a date, as milliseconds from now. */
export function retryAfterOf(response: Response, now = Date.now()): { retryAfterMs?: number } {
  const value = response.headers.get('Retry-After')?.trim() ?? '';
  if (value === '') return {};
  if (/^\d+$/.test(value)) return { retryAfterMs: Number(value) * 1000 };
  const date = Date.parse(value);
  return Number.isNaN(date) ? {} : { retryAfterMs: Math.max(0, date - now) };
}

export const auditTransport: AuditTransport = {
  async sendEvents(batch) {
    let result;
    try {
      result = await api.POST('/api/audit/client-events', { body: batch });
    } catch (error) {
      const appError = toAppError(error);
      if (NO_ANSWER.has(appError.kind)) return { kind: 'unreachable' };
      if (NOT_NOW.has(appError.kind)) {
        return { kind: 'later', status: appError.details.status ?? 503 };
      }
      throw error;
    }
    const { data, response } = result;
    if (response.ok) {
      const parsed = ClientEventBatchResultSchema.safeParse(data?.data);
      // An answer that breaks the contract: the API failed on the batch.
      return parsed.success
        ? { kind: 'answered', results: parsed.data.results }
        : { kind: 'later', status: 500 };
    }
    if (response.status === 401 || response.status === 429 || response.status >= 500) {
      return { kind: 'later', status: response.status, ...retryAfterOf(response) };
    }
    return { kind: 'refused', status: response.status };
  },

  activity: ({ cursor, limit }, signal) =>
    unwrapWith(
      api.GET('/api/account/activity', {
        params: { query: { ...(cursor === undefined ? {} : { cursor }), limit } },
        signal,
      }),
      ActivityPageSchema,
    ),

  async securityPrompts(signal) {
    const list = await unwrapWith(
      api.GET('/api/account/security-prompts', { signal }),
      SecurityPromptListSchema,
    );
    return list.items;
  },

  answerPrompt: (id, answer) =>
    unwrapWith(
      api.POST('/api/account/security-prompts/{id}/answer', {
        params: { path: { id } },
        body: { answer },
      }),
      AnsweredSecurityPromptSchema,
    ),

  async registerPushToken(token, platform) {
    const { error, response } = await api.PUT('/api/account/push-token', {
      body: { token, platform },
    });
    // 404: the API has no push module (AUDIT_HUB_PUSH): nothing to register.
    if (response.status === 404) return false;
    if (!response.ok) throw errorFromResponse(response, error);
    return true;
  },

  async unregisterPushToken(token) {
    const { error, response } = await api.DELETE('/api/account/push-token', { body: { token } });
    if (!response.ok && response.status !== 404) throw errorFromResponse(response, error);
  },
};
