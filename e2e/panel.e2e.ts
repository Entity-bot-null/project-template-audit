import { registerApplication } from './support/apps.js';
import { expect, test } from './support/fixtures.js';
import { ingest } from './support/ingest.js';
import { ADMIN, signIn } from './support/session.js';

// The admin pages in a real browser, through the real ingestion: an
// administrator registers an application (after a step-up), the application
// sends its audit log, and the explorer shows it. Values from events are
// text, never markup (docs/adr/0014): the payloads below must show as typed
// and run nothing.

const PAYLOADS = [
  '<script>window.__xss = 1</script>',
  '${alert(1)}',
  '" onmouseover="window.__xss = 1',
  'javascript:alert(1)',
] as const;

test('an administrator registers an application, whose events the explorer shows as text', async ({
  page,
  playwright,
  baseURL,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await signIn(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Register: the step-up first, then the secrets, shown once.
  const { credentials } = await registerApplication(page, 'Shop');

  // The application sends its log, with hostile text wherever text goes.
  const api = await playwright.request.newContext({ baseURL });
  await ingest(
    api,
    credentials,
    {
      catalogFormat: 1,
      app: { name: 'shop', version: '1.0.0' },
      actions: {
        'auth.session.sign_in_failed': {
          category: 'security',
          severity: 'low',
          description: PAYLOADS[0],
          source: 'server',
          details: { fields: { note: { type: 'string' } } },
        },
      },
    },
    [
      {
        category: 'security',
        action: 'auth.session.sign_in_failed',
        outcome: 'failure',
        actor: { type: 'user', id: 'user-1', label: PAYLOADS[1] },
        resource: { type: 'account', id: 'user-1', label: PAYLOADS[3] },
        network: { ip: '203.0.113.7', userAgent: PAYLOADS[2] },
        details: { note: PAYLOADS.join(' ') },
      },
    ],
  );
  await api.dispose();

  // The explorer, filtered to the application, then the event.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Events' })
    .click();
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await page
    .getByLabel('Application', { exact: true })
    .selectOption({ label: 'Shop (production)' });
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/appId=/);
  // The row in words: the catalog's description and the actor's label, as text.
  const row = page.getByRole('row').filter({ hasText: 'auth.session.sign_in_failed' });
  await expect(row).toContainText(PAYLOADS[0]);
  await expect(row).toContainText(PAYLOADS[1]);
  await expect(row.getByText('failure', { exact: true })).toHaveClass(/outcome-failure/);

  // Its whole detail beside the table, asked for when opened.
  await row.getByRole('button', { name: /^View details/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Event detail' });
  await expect(drawer.getByRole('heading', { level: 3, name: PAYLOADS[0] })).toBeVisible();
  for (const payload of PAYLOADS) await expect(drawer).toContainText(payload);
  await expect(drawer.locator('.json-code')).toContainText('"note"');
  await expect(drawer.locator('script')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // The same event as a page of its own.
  await row.getByRole('button', { name: /^View details/ }).click();
  await drawer.getByRole('link', { name: 'Open as a page' }).click();
  await expect(page.getByRole('heading', { level: 1, name: PAYLOADS[0] })).toBeVisible();

  const main = page.getByRole('main');
  for (const payload of PAYLOADS) await expect(main).toContainText(payload);
  await expect(main.locator('script')).toHaveCount(0);
  await expect(main.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(main.locator('[onmouseover]')).toHaveCount(0);
  await main.getByText(PAYLOADS[2], { exact: false }).first().hover();
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  expect(dialogs).toEqual([]);

  // The person, all around: the actor's page from the event.
  await main.getByRole('link', { name: 'user-1' }).first().click();
  await expect(page.getByRole('heading', { name: 'User user-1' })).toBeVisible();
});
