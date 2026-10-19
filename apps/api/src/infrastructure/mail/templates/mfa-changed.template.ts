import { z } from 'zod';
import { renderMail } from './layout.js';
import type { MailTemplate } from './registry.js';

/** What the message is about: queued by the second factor's flows (auth/mfa/mfa.service.ts). */
export const MfaChangedPayloadSchema = z.object({
  change: z.enum(['enrolled', 'recovery_code_used', 'recovery_codes_regenerated', 'reset']),
  /** When it happened, ISO 8601. */
  at: z.iso.datetime(),
});

const WHAT: Record<
  z.infer<typeof MfaChangedPayloadSchema>['change'],
  { subject: string; text: string }
> = {
  enrolled: {
    subject: 'A second factor was set up for your account',
    text: 'An authenticator app was set up as the second factor of your account',
  },
  recovery_code_used: {
    subject: 'A recovery code was used to sign in to your account',
    text: 'One of your recovery codes was used to sign in to your account',
  },
  recovery_codes_regenerated: {
    subject: 'Your recovery codes were replaced',
    text: 'New recovery codes were made for your account; the old ones no longer work',
  },
  reset: {
    subject: 'Your second factor was reset',
    text: 'An administrator reset the second factor of your account; you set up a new one at your next sign-in',
  },
};

// Audit Hub: a security notice to the account's address when its second
// factor changes, or a recovery code is used (docs/adr/0012). A person who
// did not do it learns it. Never held back by the per-address limits.
export const mfaChangedTemplate: MailTemplate = {
  limited: false,
  ttlMs: 24 * 60 * 60_000,
  async compose({ tx, message, product, appOrigin }) {
    if (message.userId === null) return null;
    const user = await tx.user.findUnique({ where: { id: message.userId }, select: { id: true } });
    if (user === null) return null;
    const payload = MfaChangedPayloadSchema.safeParse(message.payload);
    if (!payload.success) return null;
    const what = WHAT[payload.data.change];
    const when = payload.data.at.replace('T', ' ').replace(/\.\d+Z$|Z$/, '');
    return renderMail(
      {
        subject: `${product}: ${what.subject}`,
        heading: what.subject,
        paragraphs: [`${what.text}, on ${when} UTC.`],
        action: { label: 'Review your account', url: `${appOrigin}/account` },
        footer: [
          'If it was you, there is nothing to do.',
          'If it was not, tell an administrator of Audit Hub right away: someone may know your password.',
        ],
      },
      product,
    );
  },
};
