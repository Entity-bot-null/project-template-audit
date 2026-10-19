import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCapabilitiesForTests } from '../auth/capabilities';
import { clearSession, resetForTests, setSession } from '../auth/session';
import { member } from '../test/fixtures';
import { failure, json, ok, stubFetch } from '../test/http';
import { renderRoute } from '../test/render';

const SIGN_UP = 'POST /api/auth/sign-ups';
const CAPABILITIES = 'GET /api/auth/capabilities';
/** What the deployment offers: the form shows only where sign-up is open. */
const offers = (signUp: boolean) => () =>
  ok({ passwordReset: true, signUp, emailChange: true, invitations: true });
const OPEN = { [CAPABILITIES]: offers(true) };
const GOOD = 'violet harbour lantern 7';
const accepted = () => json(202, { data: null, message: 'Operation successful' });

beforeEach(() => {
  resetForTests();
  resetCapabilitiesForTests();
  clearSession();
});
afterEach(() => {
  resetForTests();
});

async function signUp({ name = 'Ada Lovelace', email = 'ada@example.com', password = GOOD } = {}) {
  await screen.findByLabelText('Name');
  const user = userEvent.setup();
  if (name) await user.type(screen.getByLabelText('Name'), name);
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create my account' }));
  return user;
}

describe('SignUpPage', () => {
  it.each([
    ['closed', offers(false)],
    ['unknown', () => failure(503, 'down')],
  ])('says how accounts are made where sign-up is %s, without a form', async (_case, answer) => {
    const { calls } = stubFetch({ [CAPABILITIES]: answer });
    renderRoute('/sign-up');
    expect(
      await screen.findByText(
        "Sign-up is not open here: accounts come from an administrator's invitation.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    // The notice is up from the first render, before the capabilities are
    // asked for: wait for that one request, and see it is the only one.
    await vi.waitFor(() => {
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });
  });

  it('checks every field before calling the API', async () => {
    const { calls } = stubFetch(OPEN);
    renderRoute('/sign-up');
    await signUp({ name: '', email: 'not-an-email', password: 'short' });
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 15 characters (5 now).')).toBeInTheDocument();
    // Only what the deployment offers was asked.
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('refuses a password made of the name or the email', async () => {
    const { calls } = stubFetch(OPEN);
    renderRoute('/sign-up');
    await signUp({ password: 'lovelace and her engines' });
    expect(
      screen.getByText('Leave your email address and your name out of your password.'),
    ).toBeInTheDocument();
    // Only what the deployment offers was asked.
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('sends the sign-up and says the same whether or not the address has an account', async () => {
    const { calls } = stubFetch({ ...OPEN, [SIGN_UP]: accepted });
    renderRoute('/sign-up');
    const user = await signUp({ name: '  Ada Lovelace ', email: ' ada@example.com ' });

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'A message is on its way to ada@example.com',
    );
    await expect(calls.find((call) => call.method === 'POST')?.json()).resolves.toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: GOOD,
    });
    await user.click(screen.getByRole('button', { name: 'try again' }));
    // The password is not kept once sent.
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('shows a refused address next to the email field, not as a password problem', async () => {
    stubFetch({ ...OPEN, [SIGN_UP]: () => failure(400, 'email: Invalid email address') });
    renderRoute('/sign-up');
    await signUp({ email: 'a..b@example.com' });
    expect(await screen.findByText('Enter a valid email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.queryByText(/Choose another password/)).toBeNull();
  });

  it.each([
    [400, 'password: too common', 'Choose another password'],
    [400, 'name: Too long', 'Enter your name (up to 100 characters).'],
    [403, 'Sign-up is closed', 'Sign-up is closed here.'],
    [429, 'Too many', 'Too many attempts.'],
  ])('explains a %i', async (status, message, shown) => {
    stubFetch({ ...OPEN, [SIGN_UP]: () => failure(status, message) });
    renderRoute('/sign-up');
    await signUp();
    expect(await screen.findByText(shown, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeEnabled();
  });

  it('is for signed-out visitors only', async () => {
    stubFetch({});
    setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
    const router = renderRoute('/sign-up');
    await screen.findByRole('heading', { name: `Welcome, ${member.name}` });
    expect(router.state.location.pathname).toBe('/');
  });
});
