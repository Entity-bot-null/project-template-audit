import { z } from 'zod';
import { ROLES } from '../../common/types/request-user.js';

export const UserAccessSchema = z.object({
  userId: z.uuid(),
  role: z.enum(ROLES),
  /** When the second factor was set up; null until the next sign-in sets one up. */
  mfaConfirmedAt: z.iso.datetime().nullable(),
  /** When an administrator disabled the account; null while it may sign in. */
  disabledAt: z.iso.datetime().nullable(),
  /** When an administrator removed the account (it stays disabled); null otherwise. */
  removedAt: z.iso.datetime().nullable(),
  /** The applications an auditor or a viewer may see (admins see every one, members none). */
  apps: z.array(z.object({ appId: z.uuid(), slug: z.string(), name: z.string() })),
});
export type UserAccessResponse = z.infer<typeof UserAccessSchema>;

export const VisibleAppsSchema = z.object({
  items: z.array(
    z.object({
      appId: z.uuid(),
      slug: z.string(),
      name: z.string(),
      environment: z.string(),
      status: z.string(),
      /** Audit Hub's own application: its log of sign-ins, changes and reads (administrators only). */
      system: z.boolean(),
    }),
  ),
});
export type VisibleAppsResponse = z.infer<typeof VisibleAppsSchema>;

export const ChangeRoleSchema = z.object({ role: z.enum(ROLES) });
export type ChangeRoleDto = z.infer<typeof ChangeRoleSchema>;

export const ChangeStatusSchema = z.object({
  /** true: no sign-in until enabled again; every session ends at once. */
  disabled: z.boolean(),
});
export type ChangeStatusDto = z.infer<typeof ChangeStatusSchema>;

export const AssignAppsSchema = z.object({
  /** The whole list: assignments not in it end. */
  appIds: z.array(z.uuid()).max(32),
});
export type AssignAppsDto = z.infer<typeof AssignAppsSchema>;
