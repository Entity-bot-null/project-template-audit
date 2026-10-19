import { randomUUID } from 'node:crypto';
import { expect, test } from './support/fixtures.js';

// Audit Hub has no public sign-up (docs/security.md#sign-up): its accounts
// come from an administrator's invitation or user:create. In a real browser
// and against the API: no way in is offered, and the API refuses one.

test('offers no way to create an account: none on the sign-in page, a notice on its old address', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);

  await page.goto('/sign-up');
  await expect(
    page.getByText("Sign-up is not open here: accounts come from an administrator's invitation."),
  ).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('is closed at the API too: a request to sign up is refused, and nothing is sent', async ({
  request,
}) => {
  const offered = await request.get('/api/auth/capabilities');
  expect(offered.ok()).toBe(true);
  expect(((await offered.json()) as { data: { signUp: boolean } }).data.signUp).toBe(false);

  const refused = await request.post('/api/auth/sign-ups', {
    data: {
      name: 'Katherine Johnson',
      email: `e2e-${randomUUID()}@example.test`,
      password: 'quiet orchard compass 42',
    },
  });
  expect(refused.status()).toBe(403);
  // Refused as closed, not by any other guard.
  expect(((await refused.json()) as { message: string }).message).toBe('Sign-up is closed');
});
