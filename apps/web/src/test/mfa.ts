import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The second factor's step as a person goes through it, for the specs of the
// pages that lead to it (sign-in, sign-up confirmation, invitations).

export const VERIFY = 'POST /api/auth/mfa/verify';
export const ENROLL = 'POST /api/auth/mfa/enroll';
export const ENROLL_CONFIRM = 'POST /api/auth/mfa/enroll/confirm';

export async function enterCode(code = '123456') {
  await screen.findByRole('heading', { name: 'Two-step verification' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Code'), code);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

/** Scans nothing, types the code, keeps the recovery codes and continues. */
export async function setUpSecondFactor(code = '123456') {
  await screen.findByRole('img', { name: /QR code/ });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Code'), code);
  await user.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));
  await screen.findByRole('heading', { name: 'Save your recovery codes' });
  await user.click(screen.getByRole('checkbox', { name: 'I have saved these codes' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}
