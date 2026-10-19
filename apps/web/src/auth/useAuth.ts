import { useSyncExternalStore } from 'react';
import {
  acceptInvitation,
  changePassword,
  confirmEnrollment,
  confirmSignUp,
  enterSession,
  getState,
  retrySignOut,
  signIn,
  signOut,
  startEnrollment,
  stepUp,
  subscribe,
  verifyMfa,
} from './session';
import type { AuthState } from './types';

export type Auth = AuthState & {
  signIn: typeof signIn;
  verifyMfa: typeof verifyMfa;
  startEnrollment: typeof startEnrollment;
  confirmEnrollment: typeof confirmEnrollment;
  enterSession: typeof enterSession;
  stepUp: typeof stepUp;
  signOut: typeof signOut;
  retrySignOut: typeof retrySignOut;
  changePassword: typeof changePassword;
  confirmSignUp: typeof confirmSignUp;
  acceptInvitation: typeof acceptInvitation;
};

/** Reactive view of the session store: status, user and the actions. */
export function useAuth(): Auth {
  const state = useSyncExternalStore(subscribe, getState, getState);
  return {
    ...state,
    signIn,
    verifyMfa,
    startEnrollment,
    confirmEnrollment,
    enterSession,
    stepUp,
    signOut,
    retrySignOut,
    changePassword,
    confirmSignUp,
    acceptInvitation,
  };
}
