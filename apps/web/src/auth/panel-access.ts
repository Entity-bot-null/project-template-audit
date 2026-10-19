/**
 * What a 403 means while signing in (the API's auth/panel-access.ts): the
 * password was right, but the account may not use the panel. Only
 * administrators, and auditors and viewers with an application assigned,
 * sign in; a member, or an auditor or a viewer without one, is told this.
 */
export const NO_PANEL_ACCESS_MESSAGE =
  'Your account does not have administrative access to this panel.';
