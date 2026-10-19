import { lazy, type ReactNode, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { isReauthenticationRequired, type StepUp, StepUpContext } from './step-up';

// The dialog is its own chunk, fetched the first time a step-up is needed:
// the bundle every visit loads stays within its budget.
const StepUpDialog = lazy(() =>
  import('./StepUpDialog').then(({ StepUpDialog }) => ({ default: StepUpDialog })),
);

/** Gives the pages under it `useStepUp()`, and shows the step-up dialog when one is needed. */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState(false);
  // One question at a time: every request waiting on it gets the same answer.
  const answer = useRef<Promise<boolean> | null>(null);
  const settle = useRef<((confirmed: boolean) => void) | null>(null);

  const ask = useCallback((): Promise<boolean> => {
    answer.current ??= new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setAsking(true);
    });
    return answer.current;
  }, []);

  const done = useCallback((confirmed: boolean) => {
    settle.current?.(confirmed);
    settle.current = null;
    answer.current = null;
    setAsking(false);
  }, []);

  const value = useMemo<StepUp>(
    () => ({
      async recent(send) {
        const first = await send();
        if (first.ok || !isReauthenticationRequired(first.failure)) return first;
        // Cancelled: the 403 stands, and the page says the action did not happen.
        if (!(await ask())) return first;
        return send();
      },
    }),
    [ask],
  );

  return (
    <StepUpContext value={value}>
      {children}
      {asking && (
        <Suspense fallback={null}>
          <StepUpDialog onDone={done} />
        </Suspense>
      )}
    </StepUpContext>
  );
}
