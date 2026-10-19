import type { Role } from '../common/types/request-user.js';
import type { Prisma } from '../prisma/generated/client.js';

/** 403: the right password, for an account that may not use the panel. */
export const NO_PANEL_ACCESS = 'Your account does not have administrative access to this panel';

// Who may sign in to Audit Hub's panel (docs/security.md#who-may-sign-in):
// administrators, and auditors and viewers who see at least one application
// still in service. A member, or an auditor or a viewer without one, keeps the
// account but starts no session: sign-in answers 403 once the password is
// right (before the second factor), so does every start of a session (a code,
// a recovery code, the set-up after an invitation, a new password), and a
// refresh ends the session instead of renewing it. Read from the database
// each time: an access token carries the role, not the applications.

/** What the check reads of an account: its role, and the applications it sees. */
export const PANEL_ACCESS_SELECT = {
  role: true,
  _count: { select: { appAssignments: { where: { app: { status: { not: 'retired' } } } } } },
} satisfies Prisma.UserSelect;

export function mayUsePanel(user: { role: Role; _count: { appAssignments: number } }): boolean {
  if (user.role === 'admin') return true;
  return (user.role === 'auditor' || user.role === 'viewer') && user._count.appAssignments > 0;
}
