import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '../audit/format';
import { StepUpProvider } from '../audit/StepUpProvider';
import { resetForTests, setSession } from '../auth/session';
import { member } from '../test/fixtures';
import { deferred, failure, ok, RECOVERY_CODES, session, stubFetch } from '../test/http';
import { AccountMfaSection } from './AccountMfaSection';

const STATUS = 'GET /api/account/mfa';
const NEW_CODES = 'POST /api/account/mfa/recovery-codes';
const STEP_UP = 'POST /api/account/step-up';
const CONFIRMED_AT = '2026-10-01T09:15:00.000Z';
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const needsStepUp = () =>
  failure(403, 'A recent step-up is required', { 'Audit-Error': 'reauthentication_required' });
const status = (recoveryCodesLeft: number, confirmedAt: string | null = CONFIRMED_AT) =>
  ok({ confirmedAt, recoveryCodesLeft });

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
});
afterEach(() => {
  resetForTests();
});

function show(handlers: Parameters<typeof stubFetch>[0]) {
  const fetched = stubFetch(handlers);
  render(
    <StepUpProvider>
      <AccountMfaSection />
    </StepUpProvider>,
  );
  return { ...fetched, user: userEvent.setup() };
}

const section = () => screen.getByRole('region', { name: 'Two-step verification' });
const makeCodes = () => screen.getByRole('button', { name: 'Make new recovery codes' });

describe('AccountMfaSection', () => {
  it('says since when the second factor is on, and the recovery codes left', async () => {
    show({ [STATUS]: () => status(7) });
    expect(section()).toHaveTextContent('Loading your second factor…');
    expect(
      await screen.findByText(`On since ${formatDateTime(CONFIRMED_AT)}. Recovery codes left: 7.`),
    ).toBeInTheDocument();
    expect(makeCodes()).toBeEnabled();
  });

  it('says when it is not set up', async () => {
    show({ [STATUS]: () => status(0, null) });
    expect(await screen.findByText('Not set up.')).toBeInTheDocument();
  });

  it('explains a status that did not load, and retries it', async () => {
    let attempts = 0;
    const { user } = show({
      [STATUS]: () => (++attempts === 1 ? failure(503, 'Database unreachable') : status(10)),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The service is unavailable. Try again later.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Recovery codes left: 10\./)).toBeInTheDocument();
  });

  it('makes new recovery codes once the person confirms it is them, and shows them once', async () => {
    let left = 3;
    const { calls, user } = show({
      [STATUS]: () => status(left),
      [NEW_CODES]: (request) => {
        if (request.headers.get('Authorization') !== 'Bearer token-2') return needsStepUp();
        left = 10;
        return ok({ recoveryCodes: RECOVERY_CODES });
      },
      [STEP_UP]: () => session('token-2'),
    });
    await screen.findByText(/Recovery codes left: 3\./);
    await user.click(makeCodes());

    const dialog = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(dialog.getByLabelText('Password'), 'member-password');
    await user.type(dialog.getByLabelText('Code'), '123456');
    await user.click(dialog.getByRole('button', { name: 'Confirm' }));

    const codes = await screen.findByTestId('recovery-codes');
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(RECOVERY_CODES);
    expect(screen.getByText(/The old ones no longer work/)).toBeInTheDocument();
    // The status is asked again: the new count.
    expect(await screen.findByText(/Recovery codes left: 10\./)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls.map(routeOf)).toEqual([STATUS, NEW_CODES, STEP_UP, NEW_CODES, STATUS]);

    await user.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByTestId('recovery-codes')).toBeNull();
    expect(makeCodes()).toBeEnabled();
  });

  it('makes no new codes when the person cancels the step-up, and says why', async () => {
    const { calls, user } = show({ [STATUS]: () => status(3), [NEW_CODES]: needsStepUp });
    await screen.findByText(/Recovery codes left: 3\./);
    await user.click(makeCodes());
    expect(screen.getByRole('button', { name: 'Making new codes…' })).toBeDisabled();
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No new codes: it needs you to confirm it is you.',
    );
    expect(makeCodes()).toBeEnabled();
    expect(screen.queryByTestId('recovery-codes')).toBeNull();
    expect(calls.map(routeOf)).toEqual([STATUS, NEW_CODES]);
  });

  it('explains any other failure, and clears it on the next try', async () => {
    const later = deferred<Response>();
    let attempts = 0;
    const { user } = show({
      [STATUS]: () => status(3),
      [NEW_CODES]: () =>
        ++attempts === 1 ? failure(429, 'Too many', { 'Retry-After': '20' }) : later.promise,
    });
    await screen.findByText(/Recovery codes left: 3\./);
    await user.click(makeCodes());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait 20 seconds and retry.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(makeCodes());
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    later.resolve(failure(500, 'Boom'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The service is unavailable. Try again later.',
    );
  });
});
