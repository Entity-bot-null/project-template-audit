import {
  infiniteQueryOptions,
  mutationOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';
import type { AuditTransport } from './audit.ports';
import type { AnsweredSecurityPrompt, PromptAnswer, SecurityPrompt } from './contract';

// The account's security as server state (docs/MOBILE_ARCHITECTURE.md#state):
// TanStack Query queries over the API's routes, cached like the app's own and
// cleared with them at sign-out (queryClient.clear()).

export const auditKeys = {
  all: ['audit'] as const,
  activity: (limit: number) => ['audit', 'activity', limit] as const,
  prompts: () => ['audit', 'security-prompts'] as const,
};

/** Rows of "My account's security" per page. */
export const ACTIVITY_PAGE = 20;

/** The person's own sign-ins and changes, newest first, a page at a time. */
export function accountActivityQuery(transport: AuditTransport, limit = ACTIVITY_PAGE) {
  return infiniteQueryOptions({
    queryKey: auditKeys.activity(limit),
    queryFn: ({ pageParam, signal }) =>
      transport.activity(
        pageParam === undefined ? { limit } : { cursor: pageParam, limit },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
  });
}

/** The open "Was it you?" questions. Fresh every time: an answer may come from another phone. */
export function securityPromptsQuery(transport: AuditTransport) {
  return queryOptions({
    queryKey: auditKeys.prompts(),
    queryFn: ({ signal }) => transport.securityPrompts(signal),
    staleTime: 0,
  });
}

/** One prompt of the open ones: null once answered, expired, or never this account's. */
export function securityPromptQuery(transport: AuditTransport, id: string) {
  return queryOptions({
    ...securityPromptsQuery(transport),
    select: (prompts: SecurityPrompt[]) => prompts.find((prompt) => prompt.id === id) ?? null,
  });
}

/**
 * Answers a prompt. The user decides on its screen; never retried by itself
 * (the app's mutations never are): "not_me" ends the account's sessions.
 */
export function answerSecurityPromptMutation(transport: AuditTransport, client: QueryClient) {
  return mutationOptions<AnsweredSecurityPrompt, Error, { id: string; answer: PromptAnswer }>({
    mutationKey: [...auditKeys.all, 'answer'],
    mutationFn: ({ id, answer }) => transport.answerPrompt(id, answer),
    onSuccess: async (answered) => {
      client.setQueryData<SecurityPrompt[]>(auditKeys.prompts(), (prompts) =>
        prompts?.filter((prompt) => prompt.id !== answered.id),
      );
      await client.invalidateQueries({ queryKey: [...auditKeys.all, 'activity'] });
    },
  });
}
