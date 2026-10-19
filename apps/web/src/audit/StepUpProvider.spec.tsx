import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { type ApiResult, call } from '../api/errors';
import { resetForTests, setSession } from '../auth/session';
import { member } from '../test/fixtures';
import { failure, ok, session, stubFetch } from '../test/http';
import { useStepUp } from './step-up';
import { StepUpProvider } from './StepUpProvider';

// A sensitive action answers 403 `Audit-Error: reauthentication_required`
// until the person confirms it is them (docs/adr/0012); then it is sent again.
const SENSITIVE = 'POST /api/account/mfa/recovery-codes';
const STEP_UP = 'POST /api/account/step-up';
const CODES = { recoveryCodes: ['11111-abcde'] };
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const needsStepUp = () =>
  failure(403, 'A recent step-up is required', { 'Audit-Error': 'reauthentication_required' });
// The server's view: the token the step-up answers carries it.
const recentOnly = (request: Request) =>
  request.headers.get('Authorization') === 'Bearer token-2' ? ok(CODES) : needsStepUp();
const REFUSED = {
  ok: false,
  failure: {
    status: 403,
    message: 'A recent step-up is required',
    code: 'reauthentication_required',
  },
};

type Result = ApiResult<{ recoveryCodes: string[] }>;

function Probe({ onResult }: { onResult: (result: Result) => void }) {
  const stepUp = useStepUp();
  return (
    <button
      type="button"
      onClick={() => {
        void stepUp.recent(() => call(api.POST('/api/account/mfa/recovery-codes'))).then(onResult);
      }}
    >
      Act
    </button>
  );
}

function show() {
  const onResult = vi.fn<(result: Result) => void>();
  render(
    <StepUpProvider>
      <Probe onResult={onResult} />
    </StepUpProvider>,
  );
  const user = userEvent.setup();
  return { onResult, user, act: () => user.click(screen.getByRole('button', { name: 'Act' })) };
}

const dialog = () => screen.findByRole('dialog', { name: 'Confirm it is you' });

async function confirm(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  const scope = within(await dialog());
  await user.type(scope.getByLabelText('Password'), 'member-password');
  await user.type(scope.getByLabelText('Code'), code);
  await user.click(scope.getByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: member });
});
afterEach(() => {
  resetForTests();
});

describe('StepUpProvider', () => {
  it('asks for the password and a code, then sends the request again and answers its result', async () => {
    const { calls } = stubFetch({ [SENSITIVE]: recentOnly, [STEP_UP]: () => session('token-2') });
    const { onResult, user, act } = show();
    await act();

    expect(await dialog()).toHaveAttribute('aria-modal', 'true');
    // FocusHeading moves the focus in an effect, after the dialog is on the page.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toHaveFocus();
    });
    expect(onResult).not.toHaveBeenCalled();
    await confirm(user, '123 456');

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledOnce();
    });
    expect(onResult).toHaveBeenCalledWith({ ok: true, data: CODES });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.map(routeOf)).toEqual([SENSITIVE, STEP_UP, SENSITIVE]);
    await expect(calls[1]!.json()).resolves.toEqual({
      password: 'member-password',
      code: '123456',
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer token-1');
    expect(calls[2]!.headers.get('Authorization')).toBe('Bearer token-2');
  });

  it('answers the 403 when the person cancels', async () => {
    const { calls } = stubFetch({ [SENSITIVE]: recentOnly });
    const { onResult, user, act } = show();
    await act();
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(REFUSED);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.map(routeOf)).toEqual([SENSITIVE]);
  });

  it('answers the 403 when the person presses Escape', async () => {
    const { calls } = stubFetch({ [SENSITIVE]: recentOnly });
    const { onResult, user, act } = show();
    await act();
    await dialog();
    await user.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(REFUSED);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.map(routeOf)).toEqual([SENSITIVE]);
  });

  it('keeps the dialog, and the request waiting, while the step-up is refused', async () => {
    let attempts = 0;
    const { calls } = stubFetch({
      [SENSITIVE]: recentOnly,
      [STEP_UP]: () =>
        ++attempts === 1 ? failure(403, 'The password or the code is wrong') : session('token-2'),
    });
    const { onResult, user, act } = show();
    await act();
    await confirm(user, '000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password or the code is wrong, or the code was already used.',
    );
    expect(screen.getByRole('dialog', { name: 'Confirm it is you' })).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith({ ok: true, data: CODES });
    });
    expect(calls.map(routeOf)).toEqual([SENSITIVE, STEP_UP, STEP_UP, SENSITIVE]);
  });

  it('asks once for every request waiting on it, and sends each again', async () => {
    const { calls } = stubFetch({ [SENSITIVE]: recentOnly, [STEP_UP]: () => session('token-2') });
    const { onResult, user, act } = show();
    await act();
    await dialog();
    await act();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await confirm(user);
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledTimes(2);
    });
    expect(onResult.mock.calls).toEqual([[{ ok: true, data: CODES }], [{ ok: true, data: CODES }]]);
    expect(calls.map(routeOf)).toEqual([SENSITIVE, SENSITIVE, STEP_UP, SENSITIVE, SENSITIVE]);
  });

  it('answers the 403 to every waiting request when the one question is cancelled', async () => {
    stubFetch({ [SENSITIVE]: recentOnly });
    const { onResult, user, act } = show();
    await act();
    await dialog();
    await act();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledTimes(2);
    });
    expect(onResult.mock.calls).toEqual([[REFUSED], [REFUSED]]);
  });

  it('asks again for a later request once a question was answered', async () => {
    const { calls } = stubFetch({ [SENSITIVE]: recentOnly, [STEP_UP]: () => session('token-2') });
    const { onResult, user, act } = show();
    await act();
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(REFUSED);
    });

    await act();
    await confirm(user);
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenLastCalledWith({ ok: true, data: CODES });
    });
    expect(calls.map(routeOf)).toEqual([SENSITIVE, SENSITIVE, STEP_UP, SENSITIVE]);
  });

  it('answers what the request answers the second time, even another 403', async () => {
    stubFetch({ [SENSITIVE]: needsStepUp, [STEP_UP]: () => session('token-2') });
    const { onResult, user, act } = show();
    await act();
    await confirm(user);
    await vi.waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(REFUSED);
    });
    // One question per action: no loop.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('passes every other answer through untouched', async () => {
    const answers = [
      () => ok(CODES),
      () => failure(500, 'Database unreachable'),
      () => failure(403, 'Not allowed for this role'),
      () => failure(403, 'Not allowed', { 'Audit-Error': 'app_not_assigned' }),
      () => failure(429, 'Slow down', { 'Retry-After': '30', 'Audit-Error': 'rate_limited' }),
    ];
    let next = 0;
    const { calls } = stubFetch({ [SENSITIVE]: () => answers[next++]!() });
    const { onResult, act } = show();
    for (let index = 0; index < answers.length; index += 1) {
      await act();
      await vi.waitFor(() => {
        expect(onResult).toHaveBeenCalledTimes(index + 1);
      });
    }

    expect(onResult.mock.calls.map(([result]) => result)).toEqual([
      { ok: true, data: CODES },
      { ok: false, failure: { status: 500, message: 'Database unreachable' } },
      { ok: false, failure: { status: 403, message: 'Not allowed for this role' } },
      { ok: false, failure: { status: 403, message: 'Not allowed', code: 'app_not_assigned' } },
      {
        ok: false,
        failure: { status: 429, message: 'Slow down', retryAfterSec: 30, code: 'rate_limited' },
      },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.map(routeOf).filter((route) => route === STEP_UP)).toEqual([]);
  });
});
