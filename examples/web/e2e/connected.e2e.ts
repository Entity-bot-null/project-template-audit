import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../e2e/support/fixtures.js';
import { ADMIN, nextCode, SEED_TOTP_SECRET, signIn } from '../../../e2e/support/session.js';
import { EXAMPLE_WEB_URL, startExampleApi, variablesOf } from './support/example.js';

// A project created from project-template-web and connected as the
// connection guide says (.examples/web), with Audit Hub, both built and in
// real browsers: an administrator registers the project, the project starts
// with the variables shown, and what people do in it reaches Audit Hub's
// explorer, numbered without gaps, the address only as a pseudonym; what the
// page itself sees too (the SPA connector), and the person's own activity
// comes back to the project's account page.

// The example's development accounts (its template's seed).
const MEMBER = { email: 'member@example.com', password: 'member-password', name: 'Member' };
// The address the example's web server says its visitor has (TRUST_PROXY=loopback).
const VISITOR_IP = '198.18.7.7';

async function confirmItIsMe(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await dialog.getByLabel('Code', { exact: true }).fill(await nextCode(SEED_TOTP_SECRET));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
}

test('a connected project sends what happens in it to Audit Hub', async ({ page, browser }) => {
  test.setTimeout(240_000);

  // Registered in Audit Hub; its variables, shown once.
  await signIn(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Applications' }).click();
  await page.getByRole('link', { name: 'Register an application' }).click();
  await page.getByLabel('Name').fill('Example web');
  await page.getByLabel('Slug').fill(`example-${randomUUID().slice(0, 8)}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await confirmItIsMe(page);
  await expect(page.getByRole('heading', { name: 'Example web is registered' })).toBeVisible();
  const variables = variablesOf((await page.getByTestId('secret-variables').textContent()) ?? '');
  await page.getByRole('checkbox', { name: 'I have stored them' }).check();
  await page.getByRole('button', { name: 'Go to the application' }).click();

  const api = await startExampleApi(variables);
  try {
    // In the project: a wrong password, then the right one, with a way back
    // that leaves the app, as a tampered history entry would carry it (React
    // Router keeps the navigation state in history.state.usr).
    const visitor = await browser.newContext({
      baseURL: EXAMPLE_WEB_URL,
      extraHTTPHeaders: { 'X-Forwarded-For': VISITOR_IP },
    });
    const example = await visitor.newPage();
    await example.goto('/sign-in');
    await example.evaluate(() => {
      history.replaceState({ usr: { from: '//elsewhere.example.net/' }, key: 'e2e', idx: 0 }, '');
    });
    await example.reload();
    await example.getByLabel('Email').fill(MEMBER.email);
    await example.getByLabel('Password', { exact: true }).fill('not-the-password');
    await example.getByRole('button', { name: 'Sign in' }).click();
    await expect(example.getByRole('alert')).toHaveText('Invalid email or password.');
    await example.getByLabel('Password', { exact: true }).fill(MEMBER.password);
    await example.getByRole('button', { name: 'Sign in' }).click();
    // Refused: home, not elsewhere.
    await expect(example).toHaveURL(`${EXAMPLE_WEB_URL}/`);

    // In Audit Hub, within seconds (the forwarder's round is every 2).
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Events' })
      .click();
    await page
      .getByLabel('Application', { exact: true })
      .selectOption({ label: 'Example web (production)' });
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/appId=/);
    const signedIn = page.getByRole('row').filter({ hasText: 'auth.session.signed_in' });
    await expect(async () => {
      await page.reload();
      await expect(signedIn).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    const failed = page.getByRole('row').filter({ hasText: 'auth.session.sign_in_failed' });
    await expect(failed).toHaveCount(1);
    // The page's own report of the refusal: its reporter sends every 30 s.
    const refused = page
      .getByRole('row')
      .filter({ hasText: 'client.navigation.return_path_rejected' });
    await expect(async () => {
      await page.reload();
      await expect(refused).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 90_000 });

    // The failure as Audit Hub keeps it: the account by its name (the
    // connector sends it), in its row and in its detail, with the visitor's
    // address; never the account's address in clear.
    await expect(failed).toContainText(MEMBER.name);
    await failed.getByRole('button', { name: /^View details/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Event detail' });
    await expect(drawer.getByText('auth.session.sign_in_failed', { exact: true })).toBeVisible();
    await expect(drawer).toContainText(VISITOR_IP);
    await expect(drawer).toContainText(MEMBER.name);
    await expect(drawer).not.toContainText(MEMBER.email);
    await expect(page.getByRole('main')).not.toContainText(MEMBER.email);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // The overview: the project's heartbeat, and no event missing.
    await page.goto('/');
    const card = page.getByRole('article', { name: 'Example web' });
    await expect(card.locator('dt:text-is("Last heartbeat") + dd')).not.toHaveText('—');
    await expect(card.locator('dt:text-is("Missing events") + dd')).toHaveText('none');

    // Back in the project: the person's own activity, as Audit Hub keeps it.
    await example.goto('/account');
    const activity = example.getByRole('region', { name: 'Recent activity' });
    await expect(
      activity.getByRole('listitem').filter({ hasText: 'A user signed in.' }),
    ).toHaveCount(1);
    await visitor.close();
  } finally {
    await api.stop();
  }
});
