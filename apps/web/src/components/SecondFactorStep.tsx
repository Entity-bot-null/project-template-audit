import { type ComponentProps, lazy, Suspense } from 'react';
import { LoadingScreen } from './LoadingScreen';
import type { SecondFactor } from './SecondFactor';
import { loadSecondFactor } from './second-factor-loader';

const LazySecondFactor = lazy(() =>
  loadSecondFactor().then(({ SecondFactor }) => ({ default: SecondFactor })),
);

/** The second factor's step, loaded on demand (second-factor-loader.ts). */
export function SecondFactorStep(props: ComponentProps<typeof SecondFactor>) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LazySecondFactor {...props} />
    </Suspense>
  );
}
