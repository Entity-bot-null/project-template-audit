import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from './fixtures.js';
import { credentialsOf, type Credentials } from './ingest.js';
import { ADMIN, nextCode, SEED_TOTP_SECRET } from './session.js';

/** The step-up dialog, answered as the seeded administrator. */
export async function confirmItIsMe(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await dialog.getByLabel('Code', { exact: true }).fill(await nextCode(SEED_TOTP_SECRET));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
}

/**
 * Registers an application from the admin pages (the step-up first, then the
 * secrets, shown once), signed in as an administrator; ends on its page.
 * Answers its slug and the signing key it was given. Each test names its own
 * (`name`): the pickers list applications by name and environment.
 */
export async function registerApplication(
  page: Page,
  name: string,
): Promise<{ slug: string; credentials: Credentials }> {
  const slug = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  await page.getByRole('link', { name: 'Applications' }).click();
  await page.getByRole('link', { name: 'Register an application' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Register' }).click();
  await confirmItIsMe(page);
  await expect(page.getByRole('heading', { name: `${name} is registered` })).toBeVisible();
  const credentials = credentialsOf(
    (await page.getByTestId('secret-variables').textContent()) ?? '',
  );
  await page.getByRole('checkbox', { name: 'I have stored them' }).check();
  await page.getByRole('button', { name: 'Go to the application' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return { slug, credentials };
}
