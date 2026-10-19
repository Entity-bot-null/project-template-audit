import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, resetForTests, setSession } from '../auth/session';
import { member } from '../test/fixtures';
import { deferred, failure, session, stubFetch } from '../test/http';
import { StepUpDialog } from './StepUpDialog';

const STEP_UP = 'POST /api/account/step-up';
const CODE_ERROR = 'Enter the 6-digit code your authenticator app shows.';

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
});
afterEach(() => {
  resetForTests();
});

function show(handlers: Parameters<typeof stubFetch>[0] = {}) {
  const fetched = stubFetch(handlers);
  const onDone = vi.fn<(confirmed: boolean) => void>();
  render(<StepUpDialog onDone={onDone} />);
  return { ...fetched, onDone, user: userEvent.setup() };
}

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, code: string) {
  if (password) await user.type(screen.getByLabelText('Password'), password);
  if (code) await user.type(screen.getByLabelText('Code'), code);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
}

describe('StepUpDialog', () => {
  it('is a modal dialog that takes the focus and says why it asks', () => {
    show();
    const dialog = screen.getByRole('dialog', { name: 'Confirm it is you' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toHaveFocus();
    expect(dialog).toHaveTextContent(
      'This action needs your password and a fresh code from your authenticator app.',
    );
    expect(screen.getByLabelText('Code')).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('checks both fields before calling the API', async () => {
    const { fetchMock, onDone, user } = show();
    await fill(user, '', '');
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(screen.getByText(CODE_ERROR)).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');

    // A password, and codes that are not six digits.
    await user.type(screen.getByLabelText('Password'), 'member-password');
    for (const code of ['12345', '1234567', 'abcdef']) {
      await user.clear(screen.getByLabelText('Code'));
      await fill(user, '', code);
      expect(screen.queryByText('Enter your password.')).toBeNull();
      expect(screen.getByText(CODE_ERROR)).toBeVisible();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('asks for the password even with a good code', async () => {
    const { fetchMock, user } = show();
    await fill(user, '', '123456');
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(screen.queryByText(CODE_ERROR)).toBeNull();
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'false');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the password and the code without spaces or dashes, and confirms', async () => {
    const answer = deferred<Response>();
    const { calls, onDone, user } = show({ [STEP_UP]: () => answer.promise });
    await fill(user, 'member-password', '123-456');

    expect(await screen.findByRole('button', { name: 'Confirming…' })).toBeDisabled();
    answer.resolve(session('token-2'));
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(true);
    });
    expect(onDone).toHaveBeenCalledOnce();
    await expect(calls[0]!.json()).resolves.toEqual({
      password: 'member-password',
      code: '123456',
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer token-1');
    expect(getAccessToken()).toBe('token-2');
  });

  it('says a refused step-up did not work, without the server’s words, and empties the code', async () => {
    const { onDone, user } = show({
      [STEP_UP]: () => failure(403, 'The password or the code is wrong'),
    });
    await fill(user, 'not-the-password', '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password or the code is wrong, or the code was already used.',
    );
    expect(screen.queryByText(/The password or the code is wrong$/)).toBeNull();
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('not-the-password');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('token-1');
  });

  it('explains other failures by their status, and clears the message on the next try', async () => {
    let attempt = 0;
    const answer = deferred<Response>();
    const { onDone, user } = show({
      [STEP_UP]: () =>
        ++attempt === 1 ? failure(429, 'Too many', { 'Retry-After': '30' }) : answer.promise,
    });
    await fill(user, 'member-password', '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait 30 seconds and retry.',
    );

    await fill(user, '', '654321');
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    answer.resolve(failure(503, 'Database unreachable'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The service is unavailable. Try again later.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('closes unconfirmed with Cancel or Escape, and only those', async () => {
    const { fetchMock, onDone, user } = show();
    await user.type(screen.getByLabelText('Password'), 'typing does not close it');
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenLastCalledWith(false);
    await user.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenLastCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
