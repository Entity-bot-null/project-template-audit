import { lazy, Suspense } from 'react';
import { useAuth } from '../auth';
import { LoadingScreen } from '../components/LoadingScreen';
import { HomePage } from './HomePage';

const OverviewPage = lazy(() =>
  import('./audit/OverviewPage').then(({ OverviewPage }) => ({ default: OverviewPage })),
);

/** Home: the overview for those who read audit data (a lazy chunk), a welcome for members. */
export function IndexPage() {
  const auth = useAuth();
  if (auth.status !== 'authenticated') return null;
  if (auth.user.role === 'member') return <HomePage />;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <OverviewPage />
    </Suspense>
  );
}
