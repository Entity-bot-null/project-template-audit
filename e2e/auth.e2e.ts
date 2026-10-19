import type { BrowserContext } from '@playwright/test';
import { createAccount } from './support/accounts.js';
import { expect, test } from './support/fixtures.js';
import {
  ADMIN,
  MEMBER,
  SEED_TOTP_SECRET,
  setUpSecondFactor,
  signIn,
  submitPassword,
  totpAt,
} from './support/session.js';

// The development accounts created by the API seed (apps/api/src/seed/seed.ts),
// with its second factor; the tests that need no seeded data use their own.
// The suite runs the API in production mode: the refresh cookie has the
// __Host- prefix, which sibling subdomains cannot forge.
const REFRESH_COOKIE = '__Host-refresh_token';

async function cookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).map((cookie) => cookie.name);
}

test('sends anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('answers wrong credentials with one generic message', async ({ page }) => {
  await submitPassword(page, MEMBER.email, 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
});

test('tells a member, the password right, that the panel is not theirs, before any second factor', async ({
  page,
}) => {
  await submitPassword(page, MEMBER.email, MEMBER.password);
  await expect(page.getByRole('alert')).toHaveText(
    'Your account does not have administrative access to this panel.',
  );
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('asks for the second factor after the password, and refuses a wrong code', async ({
  page,
}) => {
  await submitPassword(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  // A code no step around now has: never right by chance.
  const now = Math.floor(Date.now() / 30_000);
  const valid = new Set(
    [now - 1, now, now + 1, now + 2].map((step) => totpAt(SEED_TOTP_SECRET, step)),
  );
  const wrong = ['000000', '111111', '222222', '333333', '444444'].find((code) => !valid.has(code));
  await page.getByLabel('Code', { exact: true }).fill(wrong ?? '');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sets up the second factor on the first sign-in, and signs in with a recovery code', async ({
  page,
}) => {
  const ada = createAccount('Ada Lovelace');
  await submitPassword(page, ada.email, ada.password);
  const codes = await setUpSecondFactor(page, ada.email);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await submitPassword(page, ada.email, ada.password);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(codes[0] ?? '');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});

test('keeps the session across a reload and ends it on sign-out', async ({ page }) => {
  const grace = createAccount('Grace Hopper');
  await signIn(page, grace);
  const welcome = page.getByRole('heading', { name: 'Overview', level: 1 });
  await expect(welcome).toBeVisible();

  // The access token lives in memory only: the reload restores the session
  // from the httpOnly refresh cookie, which page scripts cannot read.
  await page.reload();
  await expect(welcome).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain('refresh_token');
  expect(await cookieNames(page.context())).toContain(REFRESH_COOKIE);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  // The server ended the session and the browser dropped both cookies.
  await expect.poll(() => cookieNames(page.context())).not.toContain(REFRESH_COOKIE);
  expect(await cookieNames(page.context())).not.toContain('has_session');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('signs every open tab out together', async ({ context, page }) => {
  const katherine = createAccount('Katherine Johnson');
  await signIn(page, katherine);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(otherTab.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(otherTab).toHaveURL(/\/sign-in$/);
});

test('shows admins the list of users', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('cell', { name: MEMBER.email })).toBeVisible();
});
