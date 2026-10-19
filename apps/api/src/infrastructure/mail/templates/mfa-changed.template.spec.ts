import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../prisma/generated/client.js';
import type { ClaimedMessage } from '../mail.types.js';
import { mfaChangedTemplate } from './mfa-changed.template.js';

const message = (overrides: Partial<ClaimedMessage> = {}): ClaimedMessage => ({
  id: 'm1',
  kind: 'mfa_changed',
  recipient: 'ada@example.test',
  userId: 'u1',
  payload: { change: 'enrolled', at: '2026-10-15T12:34:56.789Z' },
  attempts: 1,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  requestId: null,
  ...overrides,
});

function txWith(user: { id: string } | null = { id: 'u1' }) {
  const tx = { user: { findUnique: vi.fn(() => Promise.resolve(user)) } };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

const context = { product: 'Audit Hub', appOrigin: 'https://audit.example.test' };

describe('the second factor changed message', () => {
  it('says what changed and when, in UTC, and links to the account page', async () => {
    const { tx, client } = txWith();
    const rendered = await mfaChangedTemplate.compose({
      tx: client,
      message: message(),
      ...context,
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { id: true } });
    expect(rendered?.subject).toBe('Audit Hub: A second factor was set up for your account');
    expect(rendered?.text).toContain(
      'An authenticator app was set up as the second factor of your account, on 2026-10-15 12:34:56 UTC.',
    );
    expect(rendered?.text).toContain('Review your account: https://audit.example.test/account');
    expect(rendered?.text).toContain('someone may know your password');
    expect(rendered?.html).toContain('href="https://audit.example.test/account"');
  });

  it('has a subject for each change', async () => {
    const subjects = {
      enrolled: 'A second factor was set up for your account',
      recovery_code_used: 'A recovery code was used to sign in to your account',
      recovery_codes_regenerated: 'Your recovery codes were replaced',
      reset: 'Your second factor was reset',
    };
    for (const [change, subject] of Object.entries(subjects)) {
      const rendered = await mfaChangedTemplate.compose({
        tx: txWith().client,
        message: message({ payload: { change, at: '2026-10-15T12:34:56Z' } }),
        ...context,
      });
      expect(rendered?.subject).toBe(`Audit Hub: ${subject}`);
      // Without fractional seconds too.
      expect(rendered?.text).toContain(', on 2026-10-15 12:34:56 UTC.');
    }
  });

  it('is never held back by the per-address limits, and lives a day', () => {
    expect(mfaChangedTemplate.limited).toBe(false);
    expect(mfaChangedTemplate.ttlMs).toBe(24 * 60 * 60_000);
  });

  it('is dropped without an account, or with a payload it does not know', async () => {
    await expect(
      mfaChangedTemplate.compose({
        tx: txWith().client,
        message: message({ userId: null }),
        ...context,
      }),
    ).resolves.toBeNull();
    await expect(
      mfaChangedTemplate.compose({ tx: txWith(null).client, message: message(), ...context }),
    ).resolves.toBeNull();
    for (const payload of [
      {},
      { change: 'disabled', at: '2026-10-15T12:34:56Z' },
      { change: 'reset', at: 'yesterday' },
    ]) {
      await expect(
        mfaChangedTemplate.compose({
          tx: txWith().client,
          message: message({ payload }),
          ...context,
        }),
      ).resolves.toBeNull();
    }
  });
});
