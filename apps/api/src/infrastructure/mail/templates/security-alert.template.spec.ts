import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../prisma/generated/client.js';
import type { ClaimedMessage } from '../mail.types.js';
import { securityAlertTemplate } from './security-alert.template.js';

const ALERT = '0199e0b1-0000-7000-8000-0000000000a1';

const message = (overrides: Partial<ClaimedMessage> = {}): ClaimedMessage => ({
  id: 'm1',
  kind: 'security_alert',
  recipient: 'auditor@example.test',
  userId: 'u1',
  payload: { alertId: ALERT },
  attempts: 1,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  requestId: null,
  ...overrides,
});

function txWith({
  role = 'admin',
  assigned = false,
  alert = true,
}: { role?: string; assigned?: boolean; alert?: boolean } = {}) {
  const tx = {
    alert: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          alert
            ? {
                id: ALERT,
                rule: 'credential_stuffing',
                severity: 'critical',
                title: 'Sign-ins of 12 accounts failing from one address in 15 minutes',
                appId: 'app-1',
                app: { name: 'My project', slug: 'my-project' },
              }
            : null,
        ),
      ),
    },
    user: { findUnique: vi.fn(() => Promise.resolve({ role })) },
    userAppAssignment: {
      findUnique: vi.fn(() => Promise.resolve(assigned ? { appId: 'app-1' } : null)),
    },
  };
  return tx as unknown as Prisma.TransactionClient;
}

const context = { product: 'Audit Hub', appOrigin: 'https://audit.example.test' };

describe('the security alert message', () => {
  it('names the alert and links to it, with ids only', async () => {
    const rendered = await securityAlertTemplate.compose({
      tx: txWith(),
      message: message(),
      ...context,
    });
    expect(rendered?.subject).toBe(
      '[CRITICAL] Security alert in My project: Sign-ins of 12 accounts failing from one address in 15 minutes',
    );
    expect(rendered?.text).toContain(`https://audit.example.test/alerts/${ALERT}`);
    expect(rendered?.text).toContain('Rule: credential_stuffing.');
    expect(securityAlertTemplate.limited).toBe(false);
  });

  it('goes to an auditor only while assigned to the application', async () => {
    const assigned = await securityAlertTemplate.compose({
      tx: txWith({ role: 'auditor', assigned: true }),
      message: message(),
      ...context,
    });
    expect(assigned).not.toBeNull();
    for (const tx of [txWith({ role: 'auditor' }), txWith({ role: 'viewer', assigned: true })]) {
      await expect(
        securityAlertTemplate.compose({ tx, message: message(), ...context }),
      ).resolves.toBeNull();
    }
  });

  it('is dropped when it no longer applies', async () => {
    await expect(
      securityAlertTemplate.compose({
        tx: txWith({ alert: false }),
        message: message(),
        ...context,
      }),
    ).resolves.toBeNull();
    await expect(
      securityAlertTemplate.compose({
        tx: txWith(),
        message: message({ userId: null }),
        ...context,
      }),
    ).resolves.toBeNull();
    await expect(
      securityAlertTemplate.compose({
        tx: txWith(),
        message: message({ payload: {} }),
        ...context,
      }),
    ).resolves.toBeNull();
  });
});
