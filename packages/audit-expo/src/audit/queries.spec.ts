import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { FakeTransport } from './audit.testing';
import type { SecurityPrompt } from './contract';
import {
  accountActivityQuery,
  ACTIVITY_PAGE,
  answerSecurityPromptMutation,
  auditKeys,
  securityPromptQuery,
  securityPromptsQuery,
} from './queries';

const PROMPT: SecurityPrompt = {
  id: '0199f0c4-0000-7000-8000-00000000a001',
  signals: ['new_device'],
  context: { clientType: 'android', country: 'MX' },
  createdAt: '2026-10-17T12:00:00.000Z',
  expiresAt: '2026-10-24T12:00:00.000Z',
};
const OTHER: SecurityPrompt = { ...PROMPT, id: '0199f0c4-0000-7000-8000-00000000a002' };

const ITEM = {
  eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f70',
  action: 'auth.session.signed_in',
  description: 'You signed in.',
  outcome: 'success' as const,
  occurredAt: '2026-10-17T11:00:00.000Z',
};

function setup() {
  const transport = new FakeTransport();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { transport, client };
}

describe("the account's security", () => {
  it('reads the activity a page at a time, newest first', async () => {
    const { transport, client } = setup();
    transport.pages = [
      { items: [ITEM], nextCursor: '1' },
      { items: [{ ...ITEM, eventId: '0199e0b1-6a2c-7d9e-9f1a-2b3c4d5e6f71' }] },
    ];

    const data = await client.infiniteQuery({ ...accountActivityQuery(transport), pages: 2 });

    expect(data.pages.map((page) => page.items.length)).toEqual([1, 1]);
    expect(data.pageParams).toEqual([undefined, '1']);
    expect(transport.activityQueries).toEqual([
      { limit: ACTIVITY_PAGE },
      { cursor: '1', limit: ACTIVITY_PAGE },
    ]);
    expect(accountActivityQuery(transport, 5).queryKey).toEqual(auditKeys.activity(5));

    transport.pages = [{ items: [ITEM], nextCursor: '1' }];
    await expect(
      client.infiniteQuery({ ...accountActivityQuery(transport, 5), pages: 2 }),
    ).rejects.toThrow('No page 1');
  });

  it('reads the open "Was it you?" questions, and one of them by id', async () => {
    const { transport, client } = setup();
    transport.prompts = [PROMPT, OTHER];

    expect(await client.query(securityPromptsQuery(transport))).toEqual([PROMPT, OTHER]);
    const one = securityPromptQuery(transport, OTHER.id);
    expect(one.queryKey).toEqual(auditKeys.prompts());
    expect(one.select?.([PROMPT, OTHER])).toEqual(OTHER);
    expect(one.select?.([PROMPT])).toBeNull();
  });

  it('answers one, takes it off the list, and refreshes the activity', async () => {
    const { transport, client } = setup();
    transport.prompts = [PROMPT, OTHER];
    await client.query(securityPromptsQuery(transport));
    await client.infiniteQuery(accountActivityQuery(transport));

    const answer = new MutationObserver(client, answerSecurityPromptMutation(transport, client));
    const answered = await answer.mutate({ id: PROMPT.id, answer: 'not_me' });

    expect(answered).toEqual({ ...PROMPT, answer: 'not_me' });
    expect(transport.answers).toEqual([{ id: PROMPT.id, answer: 'not_me' }]);
    expect(client.getQueryData(auditKeys.prompts())).toEqual([OTHER]);
    expect(client.getQueryState(auditKeys.activity(ACTIVITY_PAGE))?.isInvalidated).toBe(true);

    await expect(answer.mutate({ id: 'gone', answer: 'confirmed' })).rejects.toThrow('Not found');
    client.clear();
  });
});
