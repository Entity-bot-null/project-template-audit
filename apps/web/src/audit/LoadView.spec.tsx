import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadState } from '../hooks/useLoader';
import { LoadView } from './LoadView';

function show(state: LoadState<{ name: string }>) {
  const retry = vi.fn(() => Promise.resolve(true));
  render(
    <LoadView state={state} retry={retry} label="events">
      {(data) => <p>Loaded {data.name}</p>}
    </LoadView>,
  );
  return { retry, user: userEvent.setup() };
}

describe('LoadView', () => {
  it('says what is loading', () => {
    show({ kind: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading events…');
    expect(screen.queryByText(/Loaded/)).toBeNull();
  });

  it('explains a failure and retries it', async () => {
    const { retry, user } = show({
      kind: 'failed',
      failure: { status: 503, message: 'Database unreachable' },
      retrying: false,
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The service is unavailable. Try again later.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the retry button while retrying, without retrying twice', async () => {
    const { retry, user } = show({
      kind: 'failed',
      failure: { status: 0, message: 'offline' },
      retrying: true,
    });
    const button = screen.getByRole('button', { name: 'Retrying…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(retry).not.toHaveBeenCalled();
  });

  it('shows the data once it is there', () => {
    show({ kind: 'loaded', data: { name: 'the shop' } });
    expect(screen.getByText('Loaded the shop')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
