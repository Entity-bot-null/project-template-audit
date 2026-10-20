import { NavLink, Outlet } from 'react-router';
import { type Role, useAuth } from '../auth';
import { useLive } from '../audit/live/LiveContext';
import { LiveControls } from '../audit/live/LiveControls';
import { LiveProvider } from '../audit/live/LiveProvider';
import { StepUpProvider } from '../audit/StepUpProvider';

interface NavItem {
  to: string;
  label: string;
  roles: readonly Role[];
  end?: boolean;
}

const READERS: readonly Role[] = ['admin', 'auditor', 'viewer'];

// Who sees which link: the API decides what is allowed (docs/authorization.md);
// the menu only hides what would answer 403.
const NAV: readonly NavItem[] = [
  { to: '/', label: 'Home', roles: ['member'], end: true },
  { to: '/', label: 'Overview', roles: READERS, end: true },
  { to: '/events', label: 'Events', roles: READERS },
  { to: '/security', label: 'Security', roles: READERS },
  { to: '/alerts', label: 'Alerts', roles: READERS },
  { to: '/soc', label: 'SOC view', roles: READERS },
  { to: '/detection-rules', label: 'Detection rules', roles: READERS },
  { to: '/response-actions', label: 'Response actions', roles: ['admin'] },
  { to: '/exports', label: 'Exports', roles: ['admin', 'auditor'] },
  { to: '/apps', label: 'Applications', roles: ['admin'] },
  { to: '/retention', label: 'Retention', roles: ['admin'] },
  { to: '/integrity', label: 'Integrity', roles: ['admin'] },
  { to: '/admin/users', label: 'Users', roles: ['admin'] },
  { to: '/admin/invitations', label: 'Invitations', roles: ['admin'] },
  { to: '/account', label: 'Account', roles: ['admin', 'auditor', 'viewer', 'member'] },
];

/**
 * The frame of every signed-in screen. Links are shown by role; the API
 * enforces it. For the people who read alerts, the frame is live
 * (audit/live): the stream, the open alerts counted in the menu, the
 * notices and their sounds.
 */
export function AppLayout() {
  const auth = useAuth();
  if (auth.status !== 'authenticated') return null;
  const { role } = auth.user;
  return (
    <LiveProvider enabled={READERS.includes(role)}>
      <div className="layout">
        <header className="layout-header">
          <span className="brand">Audit Hub</span>
          <LiveControls />
          <div className="layout-account">
            <span>{auth.user.email}</span>
            <button type="button" onClick={() => void auth.signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <nav className="layout-nav" aria-label="Main">
          {NAV.filter((item) => item.roles.includes(role)).map((item) => (
            <NavLink key={`${item.to}-${item.label}`} to={item.to} end={item.end}>
              {item.label}
              {item.to === '/alerts' && <OpenCount />}
            </NavLink>
          ))}
        </nav>
        <main className="layout-main">
          <StepUpProvider>
            <Outlet />
          </StepUpProvider>
        </main>
      </div>
    </LiveProvider>
  );
}

/** The alerts nobody acknowledged yet, counted live beside their link. */
function OpenCount() {
  const { summary } = useLive();
  if (summary === null) return null;
  const open = Object.values(summary.open).reduce((total, count) => total + count, 0);
  if (open === 0) return null;
  const urgent = summary.open.critical + summary.open.high > 0;
  return <span className={urgent ? 'nav-count nav-count-urgent' : 'nav-count'}> {open} open</span>;
}
