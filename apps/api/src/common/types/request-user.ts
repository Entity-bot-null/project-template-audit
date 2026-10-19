// Account roles, least to most privileged. The database enum (Role in
// prisma/schema.prisma) must list the same values; a unit spec checks it.
export const ROLES = ['member', 'viewer', 'auditor', 'admin'] as const;

export type Role = (typeof ROLES)[number];

/**
 * The roles that may sign in to Audit Hub's panel (docs/security.md#who-may-sign-in):
 * administrators, and auditors and viewers with an application assigned. A
 * member keeps an account that cannot sign in.
 */
export const PANEL_ROLES = ['viewer', 'auditor', 'admin'] as const satisfies readonly Role[];

/** The authenticated caller, as the access token describes it. */
export interface RequestUser {
  id: string;
  role: Role;
  /** Unix seconds of a recent re-authentication (step-up), when the token carries one. */
  reauthAt?: number;
}
