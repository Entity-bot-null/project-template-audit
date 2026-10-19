import { NavLink, Outlet } from 'react-router';
import { type Role, useAuth } from '../auth';
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
  { to: '/response-actions', label: 'Response actions', roles: ['admin'] },
  { to: '/exports', label: 'Exports', roles: ['admin', 'auditor'] },
  { to: '/apps', label: 'Applications', roles: ['admin'] },
  { to: '/retention', label: 'Retention', roles: ['admin'] },
  { to: '/integrity', label: 'Integrity', roles: ['admin'] },
  { to: '/admin/users', label: 'Users', roles: ['admin'] },
  { to: '/admin/invitations', label: 'Invitations', roles: ['admin'] },
  { to: '/account', label: 'Account', roles: ['admin', 'auditor', 'viewer', 'member'] },
];

/** The frame of every signed-in screen. Links are shown by role; the API enforces it. */
export function AppLayout() {
  const auth = useAuth();
  if (auth.status !== 'authenticated') return null;
  const { role } = auth.user;
  return (
    <div className="layout">
      <header className="layout-header">
        <span className="brand">Audit Hub</span>
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
          </NavLink>
        ))}
      </nav>
      <main className="layout-main">
        <StepUpProvider>
          <Outlet />
        </StepUpProvider>
      </main>
    </div>
  );
}
