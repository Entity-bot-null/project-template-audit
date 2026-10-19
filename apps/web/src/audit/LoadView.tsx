import type { ReactNode } from 'react';
import { LoadFailed } from '../components/LoadFailed';
import type { LoadState } from '../hooks/useLoader';

/** What a page shows while its data loads, when it failed, and once it is there. */
export function LoadView<T>({
  state,
  retry,
  label,
  children,
}: {
  state: LoadState<T>;
  retry: () => Promise<boolean>;
  /** What is loading, for the status line: "Loading events…". */
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (state.kind === 'loading') return <p role="status">Loading {label}…</p>;
  if (state.kind === 'failed') {
    return (
      <LoadFailed failure={state.failure} retrying={state.retrying} onRetry={() => void retry()} />
    );
  }
  return <>{children(state.data)}</>;
}
