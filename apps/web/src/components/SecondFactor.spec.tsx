import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getAccessToken, getState, resetForTests } from '../auth/session';
import { member } from '../test/fixtures';
import { enrolled, enrollment, failure, RECOVERY_CODES, session, stubFetch } from '../test/http';
import { ENROLL, ENROLL_CONFIRM, VERIFY } from '../test/mfa';
import { QrCode, SecondFactor } from './SecondFactor';

const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;

beforeEach(() => {
  resetForTests();
  clearSession();
});
afterEach(() => {
  resetForTests();
  vi.unstubAllGlobals();
});

// Each test gets its own challenge: the enrollment is asked once per challenge.
let next = 0;
function show(mfa: 'verify' | 'enroll', handlers: Parameters<typeof stubFetch>[0]) {
  const fetched = stubFetch(handlers);
  const onStartOver = vi.fn();
  const onSignedIn = vi.fn();
  next += 1;
  render(
    <SecondFactor
      challenge={{ mfa, challengeToken: `challenge-${String(next)}`, expiresIn: 300 }}
      onStartOver={onStartOver}
      onSignedIn={onSignedIn}
    />,
  );
  return { ...fetched, onStartOver, onSignedIn, token: `challenge-${String(next)}` };
}

describe('SecondFactor, verifying', () => {
  it('checks the code before sending it', async () => {
    const { fetchMock } = show('verify', {});
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Code'), '12345');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText('Enter the 6-digit code your authenticator app shows.')).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says a refused code did not work, without the server's words, and empties the field", async () => {
    show('verify', { [VERIFY]: () => failure(401, 'The code is wrong or was already used') });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code did not work: it is wrong, was already used, or this step expired.',
    );
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(getState().status).toBe('anonymous');
  });

  it('says so when the account lost its way into the panel meanwhile', async () => {
    show('verify', {
      [VERIFY]: () =>
        failure(403, 'Your account does not have administrative access to this panel'),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account does not have administrative access to this panel.',
    );
    expect(getState().status).toBe('anonymous');
  });

  it('takes a recovery code instead, and starts the session', async () => {
    const { calls, token } = show('verify', { [VERIFY]: () => session('token-1') });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText('Enter one of your recovery codes.')).toBeVisible();
    await user.type(screen.getByLabelText('Recovery code'), ' abcde-fghij ');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => {
      expect(getAccessToken()).toBe('token-1');
    });
    await expect(calls[0]?.json()).resolves.toEqual({
      challengeToken: token,
      recoveryCode: 'abcde-fghij',
    });
    await user.click(screen.getByRole('button', { name: 'Use your authenticator app' }));
    expect(screen.getByLabelText('Code')).toBeVisible();
  });

  it('starts over on request', async () => {
    const { onStartOver } = show('verify', {});
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start over' }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });
});

describe('SecondFactor, setting up', () => {
  it('shows the QR code and the key, and holds the session until the recovery codes are kept', async () => {
    const { calls, onSignedIn, token } = show('enroll', {
      [ENROLL]: enrollment,
      [ENROLL_CONFIRM]: () => enrolled('token-1'),
    });
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your code…');
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeVisible();
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));

    await screen.findByRole('heading', { name: 'Save your recovery codes' });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(RECOVERY_CODES);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent(RECOVERY_CODES[0] ?? '')),
    );
    expect(getAccessToken()).toBeNull();
    const proceed = screen.getByRole('button', { name: 'Continue' });
    expect(proceed).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I have saved these codes' }));
    await user.click(proceed);

    expect(getState()).toEqual({ status: 'authenticated', user: member });
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(calls.map(routeOf)).toEqual([ENROLL, ENROLL_CONFIRM]);
    await expect(calls[1]?.json()).resolves.toEqual({ challengeToken: token, code: '654321' });
  });

  it('checks the first code, and says when it was refused', async () => {
    const { fetchMock } = show('enroll', {
      [ENROLL]: enrollment,
      [ENROLL_CONFIRM]: () => failure(401, 'The code is wrong or was already used'),
    });
    await screen.findByRole('img', { name: /QR code/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));
    expect(screen.getByText('Enter the 6-digit code your authenticator app shows.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText('Code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
  });

  it('offers to start over when the set-up cannot begin', async () => {
    const { onStartOver } = show('enroll', {
      [ENROLL]: () => failure(409, 'A second factor is set up already: sign in with it'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('This set-up ended.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start over' }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });

  it('copies the recovery codes, and says when it could not', async () => {
    show('enroll', { [ENROLL]: enrollment, [ENROLL_CONFIRM]: () => enrolled('token-1') });
    await screen.findByRole('img', { name: /QR code/ });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));
    await screen.findByRole('heading', { name: 'Save your recovery codes' });

    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('no'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied.');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(RECOVERY_CODES.join('\n')));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
  });
});

describe('QrCode', () => {
  it('draws each dark module inside a four-module quiet zone', () => {
    render(<QrCode rows={['10', '01']} label="QR" />);
    const svg = screen.getByRole('img', { name: 'QR' });
    expect(svg).toHaveAttribute('viewBox', '0 0 10 10');
    expect(svg.querySelector('path')).toHaveAttribute('d', 'M4 4h1v1h-1zM5 5h1v1h-1z');
  });
});
