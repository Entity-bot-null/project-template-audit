import { z } from 'zod';
import { PASSWORD_MAX_INPUT_LENGTH } from '../../auth.constants.js';
import { AuthSessionSchema, ONE_TIME_TOKEN } from '../../dto/auth.schemas.js';

// Second factors (docs/adr/0012). The password alone never starts a session:
// sign-in (and the sign-up and invitation flows that create an account)
// answer a challenge, and the session starts once the second factor is
// verified, or set up for the first time.

export const MfaChallengeSchema = z.object({
  /** verify: enter a code (or a recovery code). enroll: set up a factor first. */
  mfa: z.enum(['verify', 'enroll']),
  /** Single use, valid for `expiresIn` seconds, 5 attempts. */
  challengeToken: z.string(),
  expiresIn: z.int(),
});
export type MfaChallengeResponse = z.infer<typeof MfaChallengeSchema>;

const totpCode = z.string().regex(/^\d{6}$/, 'A code has 6 digits');

export const MfaVerifySchema = z
  .object({
    challengeToken: ONE_TIME_TOKEN,
    code: totpCode.optional(),
    /** One of the recovery codes shown at enrollment, instead of a code. */
    recoveryCode: z.string().trim().min(10).max(16).optional(),
  })
  .refine(
    (body) => (body.code === undefined) !== (body.recoveryCode === undefined),
    'a code or a recovery code, one of them',
  );
export type MfaVerifyDto = z.infer<typeof MfaVerifySchema>;

export const MfaEnrollStartSchema = z.object({ challengeToken: ONE_TIME_TOKEN });

export const MfaEnrollmentSchema = z.object({
  /** Base32, for an authenticator app that takes the key by hand. */
  secret: z.string(),
  /** otpauth:// URI, what the QR holds. */
  uri: z.string(),
  /** The QR's rows, "1" for a dark module: drawn as SVG by the web app. */
  qr: z.array(z.string()),
});
export type MfaEnrollment = z.infer<typeof MfaEnrollmentSchema>;

export const MfaEnrollConfirmSchema = z.object({
  challengeToken: ONE_TIME_TOKEN,
  code: totpCode,
});
export type MfaEnrollConfirmDto = z.infer<typeof MfaEnrollConfirmSchema>;

export const RecoveryCodesSchema = z.object({
  /** Shown once: each signs in once when the authenticator is lost. */
  recoveryCodes: z.array(z.string()),
});

export const EnrolledSessionSchema = AuthSessionSchema.extend({
  /** Shown once: each signs in once when the authenticator is lost. */
  recoveryCodes: z.array(z.string()),
});
export type EnrolledSession = z.infer<typeof EnrolledSessionSchema>;

export const StepUpSchema = z.object({
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_INPUT_LENGTH),
  code: totpCode,
});
export type StepUpDto = z.infer<typeof StepUpSchema>;

export const MfaStatusSchema = z.object({
  /** When the second factor was set up. */
  confirmedAt: z.iso.datetime().nullable(),
  recoveryCodesLeft: z.int(),
});

export const MfaResetSchema = z.object({
  /** Why: kept in Audit Hub's own audit log. */
  reason: z.string().trim().min(10).max(500),
});
