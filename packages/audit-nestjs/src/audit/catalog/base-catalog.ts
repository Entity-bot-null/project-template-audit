import { type ActionSpec, type FieldSpec, RESPONSE_ACTIONS } from '../contract/index.js';

// Every flow of project-template-web, as Audit Hub's base catalog
// (docs/design/audit-hub/contract.md#base-catalog): where each is recorded is
// in the connection guide. Tags drive Audit Hub's detection rules; the
// user-visible ones appear in "My account's security".

const signInMethod: FieldSpec = {
  type: 'enum',
  values: ['password', 'mfa', 'sign_up', 'invitation'],
};
const emailPseudonym: FieldSpec = { type: 'string', maxLength: 64 };

export const BASE_ACTIONS = {
  'auth.session.signed_in': {
    category: 'security',
    severity: 'info',
    description: 'A user signed in.',
    source: 'server',
    tags: ['auth.sign_in'],
    userVisible: true,
    details: { fields: { method: signInMethod } },
  },
  'auth.session.sign_in_failed': {
    category: 'security',
    severity: 'low',
    description: 'A sign-in was refused.',
    source: 'server',
    outcomes: ['failure', 'denied'],
    tags: ['auth.sign_in_failed'],
    userVisible: true,
  },
  'auth.session.signed_out': {
    category: 'security',
    severity: 'info',
    description: 'A user signed out.',
    source: 'server',
    tags: ['auth.sign_out'],
    userVisible: true,
  },
  'auth.session.reuse_detected': {
    category: 'security',
    severity: 'high',
    description:
      'A refresh token was presented again after its rotation: its whole session family was ended.',
    source: 'server',
    tags: ['auth.session_reuse'],
    userVisible: true,
  },
  'auth.session.revoked_all': {
    category: 'security',
    severity: 'medium',
    description: 'Every session of a user was ended.',
    source: 'server',
    userVisible: true,
    details: { fields: { sessions: { type: 'integer', min: 0 } } },
  },
  'auth.password.changed': {
    category: 'security',
    severity: 'medium',
    description: 'A user changed their password.',
    source: 'server',
    tags: ['auth.credential_changed'],
    userVisible: true,
  },
  'auth.password.change_failed': {
    category: 'security',
    severity: 'low',
    description: 'A password change was refused: the current password was wrong.',
    source: 'server',
    outcomes: ['failure'],
  },
  'auth.password_reset.requested': {
    category: 'security',
    severity: 'info',
    description: 'A password reset link was asked for.',
    source: 'server',
    tags: ['auth.recovery'],
  },
  'auth.password_reset.completed': {
    category: 'security',
    severity: 'medium',
    description: 'A password was reset with an emailed link.',
    source: 'server',
    tags: ['auth.recovery', 'auth.credential_changed'],
    userVisible: true,
  },
  'account.email.change_requested': {
    category: 'security',
    severity: 'low',
    description: 'A user asked to change their email address.',
    source: 'server',
    userVisible: true,
  },
  'account.email.changed': {
    category: 'security',
    severity: 'medium',
    description: 'A user changed their email address.',
    source: 'server',
    tags: ['auth.credential_changed'],
    userVisible: true,
    change: { fields: { emailHmac: emailPseudonym } },
  },
  'account.email.reverted': {
    category: 'security',
    severity: 'high',
    description: 'A change of email address was undone from the previous address.',
    source: 'server',
    tags: ['auth.recovery', 'auth.credential_changed'],
    userVisible: true,
    change: { fields: { emailHmac: emailPseudonym } },
  },
  'account.email.change_failed': {
    category: 'security',
    severity: 'low',
    description: 'A change of email address was refused.',
    source: 'server',
    outcomes: ['failure'],
  },
  'auth.sign_up.requested': {
    category: 'security',
    severity: 'info',
    description: 'Someone asked to create an account.',
    source: 'server',
  },
  'auth.sign_up.confirmed': {
    category: 'security',
    severity: 'info',
    description: 'An account was created from a confirmed sign-up.',
    source: 'server',
    tags: ['iam.account_created'],
    resourceType: 'user',
  },
  'auth.sign_up.confirm_failed': {
    category: 'security',
    severity: 'low',
    description: 'A sign-up confirmation was refused.',
    source: 'server',
    outcomes: ['failure'],
  },
  'iam.invitation.created': {
    category: 'audit',
    severity: 'low',
    description: 'An administrator invited someone.',
    source: 'server',
    resourceType: 'invitation',
    details: { fields: { role: { type: 'string', maxLength: 64 } } },
  },
  'iam.invitation.revoked': {
    category: 'audit',
    severity: 'low',
    description: 'An administrator revoked an invitation.',
    source: 'server',
    resourceType: 'invitation',
  },
  'iam.invitation.accepted': {
    category: 'audit',
    severity: 'low',
    description: 'An invitation was accepted: its account was created.',
    source: 'server',
    tags: ['iam.account_created'],
    resourceType: 'invitation',
  },
  'iam.user.created': {
    category: 'audit',
    severity: 'medium',
    description: 'An operator created an account.',
    source: 'server',
    tags: ['iam.account_created'],
    resourceType: 'user',
  },
  'iam.user.role_changed': {
    category: 'audit',
    severity: 'high',
    description: "An administrator changed a user's role.",
    source: 'server',
    tags: ['iam.privilege_changed'],
    resourceType: 'user',
    change: { fields: { role: { type: 'string', maxLength: 64 } } },
  },
  'iam.user.viewed': {
    category: 'access',
    severity: 'info',
    description: "An administrator opened another user's account.",
    source: 'server',
    tags: ['data.read_other_user'],
    resourceType: 'user',
  },
  'iam.users.listed': {
    category: 'access',
    severity: 'info',
    description: 'An administrator listed the users.',
    source: 'server',
    tags: ['data.read_other_user'],
    details: { fields: { count: { type: 'integer', min: 0 } } },
  },
  'iam.user.disabled': {
    category: 'security',
    severity: 'high',
    description: 'An account was disabled.',
    source: 'server',
    tags: ['iam.account_disabled'],
    resourceType: 'user',
  },
  'iam.user.enabled': {
    category: 'security',
    severity: 'medium',
    description: 'A disabled account was enabled again.',
    source: 'server',
    resourceType: 'user',
  },
  'auth.password.change_required': {
    category: 'security',
    severity: 'medium',
    description: 'A user must choose a new password at their next sign-in.',
    source: 'server',
    resourceType: 'user',
  },
  'account.user.deleted': {
    category: 'security',
    severity: 'medium',
    description: 'An account was deleted: Audit Hub erases its personal data.',
    source: 'server',
    tags: ['privacy.erasure_requested'],
    resourceType: 'user',
  },
  'http.request.cross_origin_refused': {
    category: 'security',
    severity: 'low',
    description: 'A cross-origin request with credentials was refused (CSRF protection).',
    source: 'server',
    outcomes: ['denied'],
    tags: ['http.rejected'],
    details: {
      fields: {
        fetchSite: { type: 'enum', values: ['cross-site', 'same-site', 'none', 'unknown'] },
      },
    },
  },
  'http.request.rate_limited': {
    category: 'security',
    severity: 'low',
    description:
      'Too many requests from one address to one route (the first each minute: recorded sampled).',
    source: 'server',
    outcomes: ['denied'],
    tags: ['http.rejected'],
  },
  'account.security_prompt.answered': {
    category: 'security',
    severity: 'info',
    description: 'A user answered "Was it you?" about a sign-in.',
    source: 'server',
    tags: ['security.prompt_answered'],
    userVisible: true,
    details: {
      fields: { answer: { type: 'enum', values: ['confirmed', 'not_me'], required: true } },
    },
  },
  'audit.response_action.executed': {
    category: 'security',
    severity: 'medium',
    description: 'The application ran, refused or could not run an action Audit Hub asked for.',
    source: 'server',
    tags: ['response.executed'],
    details: {
      fields: {
        actionId: { type: 'uuid', required: true },
        action: { type: 'enum', values: [...RESPONSE_ACTIONS], required: true },
        result: {
          type: 'enum',
          values: ['succeeded', 'failed', 'refused', 'unsupported'],
          required: true,
        },
      },
    },
  },
  // The mobile app's (audit-expo): a session began on the phone, after a
  // sign-in or when the app opened with the session it kept. A sign-in to
  // the rules: a phone the account never used, or one impossibly far from its
  // last place (the phone's own position, with the user's consent), raises
  // "Was it you?". Not user-visible: the server's sign-ins are.
  'client.session.started': {
    category: 'security',
    severity: 'info',
    description:
      "The app opened a session: after a sign-in, or with the one it kept. With the user's consent, it says where the phone was.",
    source: 'client',
    tags: ['auth.sign_in'],
  },
  'client.session.expired': {
    category: 'security',
    severity: 'low',
    description: 'The app found its session expired.',
    source: 'client',
  },
  'client.link.rejected': {
    category: 'security',
    severity: 'low',
    description: 'The app refused a link it was asked to open.',
    source: 'client',
  },
  'client.security.csp_violation': {
    category: 'security',
    severity: 'low',
    description: 'The browser blocked something the Content Security Policy forbids.',
    source: 'client',
    details: {
      fields: {
        directive: { type: 'string', maxLength: 64 },
        blockedOrigin: { type: 'string', maxLength: 256 },
      },
    },
  },
  'client.navigation.return_path_rejected': {
    category: 'security',
    severity: 'low',
    description: 'The web app refused to send a user back to a page outside itself.',
    source: 'client',
  },
} satisfies Record<string, ActionSpec>;
