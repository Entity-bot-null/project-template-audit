import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretOnce } from './SecretOnce';

const VARIABLES = {
  AUDIT_HUB_APP_ID: '0190b6a1-0000-7000-8000-00000000000a',
  AUDIT_HUB_SECRET: 'not-a-real-secret',
  AUDIT_HUB_PORT: 8443,
  AUDIT_HUB_TAGS: { region: 'eu' },
};
const TEXT = [
  'AUDIT_HUB_APP_ID=0190b6a1-0000-7000-8000-00000000000a',
  'AUDIT_HUB_SECRET=not-a-real-secret',
  'AUDIT_HUB_PORT=8443',
  'AUDIT_HUB_TAGS={"region":"eu"}',
].join('\n');

function show(doneLabel?: string) {
  const onDone = vi.fn<() => void>();
  render(<SecretOnce variables={VARIABLES} onDone={onDone} doneLabel={doneLabel} />);
  // user-event puts its own clipboard on navigator: the stub goes on top of it.
  const user = userEvent.setup();
  return { onDone, user };
}

describe('SecretOnce', () => {
  it('shows the variables once, as NAME=value lines', () => {
    show();
    expect(screen.getByText('Shown this once.')).toBeInTheDocument();
    expect(screen.getByTestId('secret-variables').textContent).toBe(TEXT);
  });

  it('copies them, with a final newline, and says so', async () => {
    const { user } = show();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied.');
    expect(writeText).toHaveBeenCalledWith(`${TEXT}\n`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when it could not copy them', async () => {
    const { user } = show();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not allowed'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy: select the text instead.',
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets the person go on only once they say they have stored them', async () => {
    const { onDone, user } = show();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();

    const kept = screen.getByRole('checkbox', { name: 'I have stored them' });
    await user.click(kept);
    expect(done).toBeEnabled();
    await user.click(kept);
    expect(done).toBeDisabled();
    await user.click(kept);
    await user.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('names the way on as the page asks', () => {
    show('Back to the application');
    expect(screen.getByRole('button', { name: 'Back to the application' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
});
