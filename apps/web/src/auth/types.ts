import type { operations } from '../api/client';

type DataOf<Operation extends keyof operations> = operations[Operation] extends {
  responses: { 200: { content: { 'application/json': { data: infer Data } } } };
}
  ? Data
  : never;

// Shapes come from the generated contract: the second factor's step and
// refresh answer with the same session body.
export type AuthSession = DataOf<'AuthController_refresh'>;
export type AuthUser = AuthSession['user'];
export type Role = AuthUser['role'];

/** What sign-in (and a confirmed sign-up or invitation) answers: the second factor's step. */
export type MfaChallenge = DataOf<'AuthController_signIn'>;
/** A new second factor's secret: an otpauth URI, its text, and its QR code's rows. */
export type MfaEnrollment = DataOf<'MfaController_enroll'>;
/** The session a confirmed second factor starts, with the recovery codes shown once. */
export type EnrolledSession = DataOf<'MfaController_confirm'>;

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export type AuthState =
  | { status: 'loading'; user: null }
  // signedOut: the user signed out on this page; 'failed' when the server
  // could not be reached to end the session (the sign-in page offers a retry).
  | { status: 'anonymous'; user: null; signedOut?: 'done' | 'failed' }
  | { status: 'authenticated'; user: AuthUser };
