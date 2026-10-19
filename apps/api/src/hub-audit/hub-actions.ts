import type { ActionSpec, HubCategory, Tag } from 'audit-contract';

// Audit Hub's own actions (docs/design/audit-hub): what its people do (sign
// in, change settings, act on alerts) and what they look at (searches,
// details, exports: audit_access, its own stream and integrity chain). They
// are events of the system application, with no sequence and no published
// catalog: this is their catalog. Tags make the detection rules apply to
// Audit Hub too (a brute force against its sign-in, a mass export).

export interface HubAction {
  /** Validates the event like an application's catalog action. */
  spec: ActionSpec;
  /** The stream it goes to; audit_access is Audit Hub's alone. */
  category: HubCategory;
}

const action = (
  category: HubCategory,
  severity: ActionSpec['severity'],
  description: string,
  extra: Partial<ActionSpec> = {},
): HubAction => ({
  category,
  spec: {
    // The contract's catalog knows no audit_access: such actions are
    // validated as audit, then stored in their own stream.
    category: category === 'audit_access' ? 'audit' : category,
    severity,
    description,
    source: 'server',
    ...extra,
  },
});

const reason = { type: 'string', maxLength: 500 } as const;
const appId = { type: 'uuid' } as const;

export const HUB_ACTIONS = {
  // --- Sign-in and second factor (security) -----------------------------------
  'hub.session.signed_in': action('security', 'info', 'Signed in to Audit Hub.', {
    tags: ['auth.sign_in'],
    details: { fields: { method: { type: 'enum', values: ['totp', 'recovery_code'] } } },
  }),
  'hub.session.sign_in_failed': action('security', 'low', 'A sign-in to Audit Hub failed.', {
    tags: ['auth.sign_in_failed'],
    details: {
      fields: {
        stage: { type: 'enum', values: ['password', 'second_factor'] },
        // The right password for an account an administrator disabled.
        accountDisabled: { type: 'boolean' },
        // The right password for an account that may not use the panel
        // (auth/panel-access.ts): outcome denied.
        noPanelAccess: { type: 'boolean' },
      },
    },
  }),
  'hub.session.stepped_up': action(
    'security',
    'info',
    'Confirmed their identity again for a sensitive action.',
  ),
  'hub.mfa.enrolled': action('security', 'medium', 'Set up their second factor.', {
    tags: ['auth.credential_changed'],
  }),
  'hub.mfa.recovery_code_used': action('security', 'high', 'Signed in with a recovery code.', {
    tags: ['auth.recovery'],
  }),
  'hub.mfa.recovery_codes_regenerated': action(
    'security',
    'medium',
    'Replaced their recovery codes.',
    { tags: ['auth.credential_changed'] },
  ),
  'hub.mfa.reset': action('security', 'high', "Reset someone's second factor.", {
    tags: ['auth.credential_changed'],
    resourceType: 'user',
    details: { fields: { reason } },
  }),

  // --- Administration (audit) ------------------------------------------------
  'hub.user.role_changed': action('audit', 'high', "Changed a person's role.", {
    tags: ['iam.privilege_changed'],
    resourceType: 'user',
    change: {
      fields: { role: { type: 'enum', values: ['member', 'viewer', 'auditor', 'admin'] } },
    },
  }),
  'hub.user.disabled': action('audit', 'high', "Disabled a person's account.", {
    tags: ['iam.account_disabled'],
    resourceType: 'user',
  }),
  'hub.user.enabled': action('audit', 'high', "Enabled a person's account again.", {
    tags: ['iam.privilege_changed'],
    resourceType: 'user',
  }),
  'hub.user.removed': action(
    'audit',
    'high',
    'Removed a person from Audit Hub: their account keeps its id, nothing of them.',
    {
      tags: ['iam.account_disabled'],
      resourceType: 'user',
      details: { fields: { alertsUnassigned: { type: 'integer', min: 0 } } },
    },
  ),
  'hub.user.apps_assigned': action(
    'audit',
    'medium',
    'Changed the applications a person may see.',
    {
      tags: ['iam.privilege_changed'],
      resourceType: 'user',
      details: { fields: { apps: { type: 'string[]', maxItems: 32, maxLength: 36 } } },
    },
  ),
  'hub.app.deleted': action(
    'audit',
    'high',
    "Deleted a connected application's audit log at the end of its service, and retired it.",
    {
      resourceType: 'connected_app',
      details: { fields: { eventsDeleted: { type: 'integer', min: 0 } } },
    },
  ),
  'hub.app.changed': action('audit', 'medium', 'Changed a connected application.', {
    resourceType: 'connected_app',
    details: {
      fields: {
        change: {
          type: 'enum',
          values: ['created', 'updated', 'key_created', 'key_revoked', 'webhook_secret_rotated'],
        },
      },
    },
  }),
  'hub.alert.updated': action('audit', 'low', 'Worked on an alert.', {
    resourceType: 'alert',
    details: {
      fields: {
        status: { type: 'enum', values: ['open', 'in_review', 'resolved', 'false_positive'] },
        assigneeId: { type: 'uuid' },
        note: { type: 'boolean' },
      },
    },
  }),
  'hub.response_action.changed': action(
    'audit',
    'high',
    'Requested, approved or cancelled a response action.',
    {
      resourceType: 'response_action',
      details: {
        fields: {
          step: { type: 'enum', values: ['requested', 'approved', 'cancelled'] },
          action: {
            type: 'enum',
            values: ['revoke_sessions', 'require_password_change', 'disable_account'],
          },
          appId,
          subject: { type: 'id' },
        },
      },
    },
  ),
  'hub.legal_hold.changed': action('audit', 'medium', 'Placed or released a legal hold.', {
    resourceType: 'legal_hold',
    details: { fields: { step: { type: 'enum', values: ['placed', 'released'] }, appId } },
  }),
  'hub.retention.changed': action('audit', 'medium', "Changed an application's retention.", {
    resourceType: 'connected_app',
    details: {
      fields: {
        class: {
          type: 'enum',
          values: ['security', 'audit', 'access', 'system', 'audit_access', 'personal', 'location'],
        },
        days: { type: 'integer', min: 1, max: 3650 },
      },
    },
  }),
  'hub.subject.erased': action(
    'audit',
    'high',
    "Erased the personal data of an application's user.",
    {
      resourceType: 'app_user',
      details: {
        fields: {
          appId,
          via: { type: 'enum', values: ['panel', 'connector'] },
          scope: { type: 'enum', values: ['personal', 'events'] },
          personalDeleted: { type: 'integer', min: 0 },
          eventsDeleted: { type: 'integer', min: 0 },
          held: { type: 'integer', min: 0 },
        },
      },
    },
  ),

  // --- What people look at (audit_access) ---------------------------------------
  'hub.events.searched': action('audit_access', 'info', 'Searched the audit log.', {
    details: {
      fields: {
        appId,
        filters: { type: 'string[]', maxItems: 20, maxLength: 32 },
        results: { type: 'integer', min: 0 },
      },
    },
  }),
  'hub.event.viewed': action('audit_access', 'info', 'Opened an event.', {
    resourceType: 'audit_event',
    details: { fields: { appId } },
  }),
  // Alerts name the people they are about (their applications' labels).
  'hub.alerts.searched': action('audit_access', 'info', 'Listed alerts.', {
    details: {
      fields: {
        appId,
        filters: { type: 'string[]', maxItems: 20, maxLength: 32 },
        results: { type: 'integer', min: 0 },
      },
    },
  }),
  'hub.alert.viewed': action('audit_access', 'info', 'Opened an alert.', {
    resourceType: 'alert',
    details: { fields: { appId } },
  }),
  'hub.subject.viewed': action(
    'audit_access',
    'info',
    "Opened the activity of an application's user.",
    {
      resourceType: 'app_user',
      details: { fields: { appId, acrossApps: { type: 'boolean' }, blocked: { type: 'boolean' } } },
    },
  ),
  'hub.resource.viewed': action('audit_access', 'info', 'Opened the history of a resource.', {
    details: { fields: { appId, type: { type: 'string', maxLength: 64 } } },
  }),
  'hub.security.viewed': action(
    'audit_access',
    'info',
    "Opened an application's security overview.",
    { details: { fields: { appId } } },
  ),
  'hub.export.created': action('audit_access', 'medium', 'Exported events.', {
    tags: ['data.bulk_export'],
    details: {
      fields: {
        appId,
        format: { type: 'enum', values: ['csv', 'jsonl'] },
        rows: { type: 'integer', min: 0 },
        digest: { type: 'string', maxLength: 64 },
        filters: { type: 'string[]', maxItems: 20, maxLength: 32 },
      },
    },
  }),
  'hub.connector.read': action(
    'audit_access',
    'info',
    "An application read its user's activity or data.",
    {
      resourceType: 'app_user',
      details: { fields: { appId, what: { type: 'enum', values: ['activity', 'export'] } } },
    },
  ),
} as const satisfies Record<string, HubAction>;

export type HubActionName = keyof typeof HUB_ACTIONS;

/** Audit Hub's actions that carry `tag` (the rules read events of the system application by them). */
export function hubActionsTagged(tag: Tag): string[] {
  return Object.entries(HUB_ACTIONS)
    .filter(
      ([, entry]) => (entry.spec.tags as readonly string[] | undefined)?.includes(tag) === true,
    )
    .map(([name]) => name);
}

/** The tags of one of Audit Hub's actions; none for any other action. */
export function hubTagsOf(action: string): string[] {
  // Own entries only: a name like 'toString' is not one of them.
  if (!Object.hasOwn(HUB_ACTIONS, action)) return [];
  const entry = (HUB_ACTIONS as Record<string, HubAction>)[action];
  return [...(entry?.spec.tags ?? [])];
}
