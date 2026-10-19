import { createContext, useContext } from 'react';
import type { ApiFailure, ApiResult } from '../api/errors';

// Sensitive actions (exports, keys, roles, erasure, legal holds...) need a
// recent step-up: the API answers 403 with `Audit-Error:
// reauthentication_required` until the person types their password and a
// fresh code again (docs/adr/0012). `recent` sends the request, and on that
// answer asks for both (StepUpProvider's dialog), then sends it once more.

export interface StepUp {
  recent<T>(send: () => Promise<ApiResult<T>>): Promise<ApiResult<T>>;
}

export const StepUpContext = createContext<StepUp | null>(null);

export function isReauthenticationRequired(failure: ApiFailure): boolean {
  return failure.status === 403 && failure.code === 'reauthentication_required';
}

export function useStepUp(): StepUp {
  const stepUp = useContext(StepUpContext);
  if (stepUp === null) throw new Error('useStepUp needs a StepUpProvider above it');
  return stepUp;
}
