import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditTransport } from './audit.ports';
import {
  accountActivityQuery,
  answerSecurityPromptMutation,
  securityPromptQuery,
  securityPromptsQuery,
} from './queries';

/**
 * The account's security for the app's screens, with no UI of their own
 * (the app's features render them): created once in audit.wiring.ts over the
 * app's transport.
 */
export function createAuditHooks(transport: AuditTransport) {
  return {
    /** "My account's security": pages of the person's own activity. */
    useAccountActivity: (limit?: number) =>
      useInfiniteQuery(accountActivityQuery(transport, limit)),
    /** The open "Was it you?" questions. */
    useSecurityPrompts: () => useQuery(securityPromptsQuery(transport)),
    /** One of them, for the screen a push opens: null once it is no longer open. */
    useSecurityPrompt: (id: string) => useQuery(securityPromptQuery(transport, id)),
    /** Answers one: "not_me" ends every session of the account. */
    useAnswerSecurityPrompt: () => {
      const client = useQueryClient();
      return useMutation(answerSecurityPromptMutation(transport, client));
    },
  };
}
