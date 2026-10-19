import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createAccount } from './support/accounts.js';
import { expect, test } from './support/fixtures.js';
import { ADMIN, nextCode, SEED_TOTP_SECRET, signIn, submitPassword } from './support/session.js';

// The ends of things in a real browser: an account that is disabled (signed
// out everywhere at once), enabled again and removed; and an application whose
// service ends (suspended, its log deleted, retired). Every step after the
// administrator's step-up.

async function confirmItIsMe(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await dialog.getByLabel('Code', { exact: true }).fill(await nextCode(SEED_TOTP_SECRET));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
}

test('an administrator disables an account, signed out at once, enables it again, then removes it', async ({
  browser,
  extraHTTPHeaders,
  page,
}) => {
  const person = createAccount('Evelyn Boyd Granville');
  const theirs = await (await browser.newContext({ extraHTTPHeaders })).newPage();
  await signIn(theirs, person);
  await expect(theirs.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  await signIn(page, ADMIN);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click();
  await page.getByRole('row').filter({ hasText: person.email }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: person.name, level: 1 })).toBeVisible();
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('button', { name: 'Disable their account…' }).click();
  await account.getByRole('button', { name: 'Disable their account', exact: true }).click();
  await confirmItIsMe(page);
  await expect(
    page.getByText(
      'Disabled: every session of theirs ended, and they cannot sign in until enabled.',
    ),
  ).toBeVisible();

  // Their open session ended; signing in answers as for a wrong password.
  await theirs.reload();
  await expect(theirs).toHaveURL(/\/sign-in$/);
  await submitPassword(theirs, person.email, person.password);
  await expect(theirs.getByRole('alert')).toHaveText('Invalid email or password.');

  await account.getByRole('button', { name: 'Enable their account' }).click();
  await expect(page.getByText('Enabled: they can sign in again.')).toBeVisible();
  await signIn(theirs, person);
  await expect(theirs.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  const removal = page.getByRole('region', { name: 'Remove from Audit Hub' });
  await removal.getByRole('button', { name: 'Remove from Audit Hub…' }).click();
  await removal.getByRole('button', { name: 'Remove them' }).click();
  await expect(page.getByRole('heading', { name: 'Removed user', level: 1 })).toBeVisible();
  await expect(page.getByText(/^Removed .*: the account keeps its id/)).toBeVisible();
  await page.getByRole('link', { name: '← Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  await expect(page.getByRole('cell', { name: person.email, exact: true })).toHaveCount(0);
  await theirs.reload();
  await expect(theirs).toHaveURL(/\/sign-in$/);
  await theirs.close();
});

test("an administrator ends an application's service: suspended, its log deleted, retired", async ({
  page,
}) => {
  await signIn(page, ADMIN);
  const slug = `old-${randomUUID().slice(0, 8)}`;
  await page.getByRole('link', { name: 'Applications' }).click();
  await page.getByRole('link', { name: 'Register an application' }).click();
  await page.getByLabel('Name').fill('Old shop');
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Register' }).click();
  await confirmItIsMe(page);
  await page.getByRole('checkbox', { name: 'I have stored them' }).check();
  await page.getByRole('button', { name: 'Go to the application' }).click();
  await expect(page.getByRole('heading', { name: 'Old shop', exact: true })).toBeVisible();

  const end = page.getByRole('region', { name: 'End of service' });
  await expect(end.getByRole('button', { name: 'Delete its audit log…' })).toBeDisabled();
  const settings = page.getByRole('region', { name: 'Settings' });
  await settings.getByLabel('Status').selectOption('suspended');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(end.getByRole('button', { name: 'Delete its audit log…' })).toBeEnabled();

  await end.getByRole('button', { name: 'Delete its audit log…' }).click();
  await end.getByLabel(`Type its slug, ${slug}, to confirm`).fill(slug);
  await end.getByRole('button', { name: 'Delete its audit log', exact: true }).click();
  await expect(page.getByText(/^Retired: its audit log was deleted/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Settings' })).toHaveCount(0);
});
