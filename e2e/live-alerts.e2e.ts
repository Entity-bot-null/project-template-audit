import { registerApplication } from './support/apps.js';
import { expect, test } from './support/fixtures.js';
import { ingest } from './support/ingest.js';
import { ADMIN, signIn } from './support/session.js';

// Real-time alerts end to end (docs/adr/0016): an application's event raises
// an alert in the real-time rules, the API's live stream carries it through
// the preview server's proxy, and the open alert center shows it with a
// notice, without a reload. Then an administrator takes it on and closes it
// with a reason.

const TITLE = 'A session token of user user-7 was used again after it was replaced';

test('an alert raised while the alert center is open arrives without a reload', async ({
  page,
  playwright,
  baseURL,
}) => {
  // The real-time rules read an event 20 s after it arrived, every 10 s.
  test.setTimeout(120_000);
  await signIn(page, ADMIN);
  const { credentials } = await registerApplication(page, 'Ledger');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Alerts' })
    .click();
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  // The stream's state, in words.
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Live');
  // A mark a reload would wipe out.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });

  const api = await playwright.request.newContext({ baseURL });
  await ingest(
    api,
    credentials,
    {
      catalogFormat: 1,
      app: { name: 'ledger', version: '1.0.0' },
      actions: {
        'auth.session.token_replayed': {
          category: 'security',
          severity: 'high',
          description: 'A replaced session token was presented again.',
          source: 'server',
          tags: ['auth.session_reuse'],
        },
      },
    },
    [
      {
        category: 'security',
        action: 'auth.session.token_replayed',
        outcome: 'denied',
        actor: { type: 'user', id: 'user-7' },
      },
    ],
  );
  await api.dispose();

  // The list and the notice, live.
  const notices = page.getByRole('region', { name: 'Alert notices' });
  await expect(notices.getByText(TITLE)).toBeVisible({ timeout: 60_000 });
  await expect(notices.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: TITLE })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
  ).toBe(true);

  // Taken on, then closed with a reason.
  await page.getByRole('main').getByRole('link', { name: TITLE }).click();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText(`by ${ADMIN.name}`, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
  await page.getByLabel('Status').selectOption('resolved');
  await page.getByLabel('How it was resolved').fill('The token was revoked by the owner.');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByText('The token was revoked by the owner.')).toBeVisible();
});
