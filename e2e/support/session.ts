import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

// Signing in as a person does (docs/adr/0012): the password, then a code from
// the account's authenticator app, computed here from its secret (RFC 6238,
// written out instead of the API's library: an independent check of it). An
// account without a second factor sets one up on its first sign-in, reading
// the key the page shows; the recovery codes are kept by ticking the box.

/** The seed's second factor (apps/api/src/seed/seed.ts): development accounts only. */
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- the seed's public development key

// The development accounts created by the API seed, with their second factor.
export const MEMBER = {
  email: 'member@example.com',
  password: 'member-password',
  name: 'Member',
};
export const ADMIN = { email: 'admin@example.com', password: 'admin-password', name: 'Admin' };

const secrets = new Map<string, string>([
  [MEMBER.email, SEED_TOTP_SECRET],
  [ADMIN.email, SEED_TOTP_SECRET],
]);

/** An account whose address changed keeps its second factor. */
export function sameSecondFactor(newEmail: string, previousEmail: string): void {
  const secret = secrets.get(previousEmail);
  if (secret !== undefined) secrets.set(newEmail, secret);
}

const PERIOD_MS = 30_000;
// The API takes each 30-second step once per account (replays are refused),
// and the step before and after the current one. Steps used are kept in a
// file the run's worker processes share (one worker, restarted after a
// failure): a retry never presents a code its failed attempt spent. The file
// is in the run's own output directory (test-results/), never under a
// predictable name in the shared temporary folder.
const stepsFile = () =>
  join(test.info().project.outputDir, `.totp-steps-${String(process.ppid)}.json`);

function usedSteps(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(stepsFile(), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Bytes(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('The key is not base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 with the app's settings: HMAC-SHA1, 6 digits, 30 seconds. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Bytes(secret)).update(counter).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * A code the API has not taken yet for this secret: the current step's, or
 * the next one's when it was taken. When both were, it waits for the next
 * step (the test's time limit grows by that wait).
 */
export async function nextCode(secret: string): Promise<string> {
  const steps = usedSteps();
  const last = steps[secret] ?? Number.NEGATIVE_INFINITY;
  let now = Math.floor(Date.now() / PERIOD_MS);
  if (last > now) {
    const wait = (last - now) * PERIOD_MS - (Date.now() % PERIOD_MS) + 200;
    test.info().setTimeout(test.info().timeout + wait);
    await new Promise((resolve) => setTimeout(resolve, wait));
    now = Math.floor(Date.now() / PERIOD_MS);
  }
  const step = Math.max(now, last + 1);
  mkdirSync(test.info().project.outputDir, { recursive: true });
  writeFileSync(stepsFile(), JSON.stringify({ ...steps, [secret]: step }));
  return totpAt(secret, step);
}

/** The password step alone: for a wrong password, or to look at the second step. */
export async function submitPassword(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in with the password and the second factor, set up first if the account has none. */
export async function signIn(page: Page, account: { email: string; password: string }) {
  await submitPassword(page, account.email, account.password);
  await passSecondFactor(page, account.email);
}

/** The second factor's step, whichever it is: a code, or the set-up. */
export async function passSecondFactor(page: Page, email: string) {
  const step = page.getByRole('heading', { name: /two-step verification$/i });
  await expect(step).toBeVisible();
  if ((await step.textContent()) === 'Two-step verification') {
    const secret = secrets.get(email);
    if (secret === undefined) throw new Error(`No second factor known for ${email}`);
    await page.getByLabel('Code', { exact: true }).fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(step).toBeHidden();
  } else {
    await setUpSecondFactor(page, email);
  }
}

/**
 * Sets up the second factor on the page that asks for it (a first sign-in, a
 * confirmed sign-up or invitation) and keeps the recovery codes.
 */
export async function setUpSecondFactor(page: Page, email: string): Promise<string[]> {
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await page.getByText("Can't scan it? Enter this key instead").click();
  const secret = (await page.getByTestId('mfa-secret').textContent())?.replace(/\s/g, '') ?? '';
  expect(secret, 'the key shown for the authenticator app').toMatch(/^[A-Z2-7]{32}$/);
  secrets.set(email, secret);
  await page.getByLabel('Code', { exact: true }).fill(await nextCode(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = await page.getByTestId('recovery-codes').getByRole('listitem').allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole('checkbox', { name: 'I have saved these codes' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  return codes;
}
