import { z } from 'zod';
import { pageOf } from '../../common/pagination.js';
import { PANEL_ROLES, ROLES } from '../../common/types/request-user.js';

// An invitation gives access to the panel (auth/panel-access.ts): an
// administrator, or an auditor or a viewer with the applications they will
// see, assigned when it is accepted. A member could never sign in.
export const CreateInvitationSchema = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()).meta({ format: 'email' }),
    role: z.enum(PANEL_ROLES),
    /** Required for an auditor or a viewer (at least one); none for an administrator, who sees every one. */
    appIds: z.array(z.uuid()).max(32).default([]),
  })
  .superRefine(({ role, appIds }, ctx) => {
    if (role === 'admin' && appIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['appIds'],
        message: 'an administrator sees every application: choose none',
      });
    }
    if (role !== 'admin' && appIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['appIds'],
        message: 'choose the applications an auditor or a viewer will see',
      });
    }
  });
export type CreateInvitationDto = z.infer<typeof CreateInvitationSchema>;

// A pending invitation as administrators see it. Never its token (only the
// hash exists) nor anything about the person beyond the address invited.
export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  /** Member only on an invitation sent before members stopped being invited: it cannot be accepted. */
  role: z.enum(ROLES),
  /** The applications the account will see; empty for an administrator. */
  apps: z.array(z.object({ appId: z.uuid(), slug: z.string(), name: z.string() })),
  /** The administrator who invited; null once that account is gone. */
  invitedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  /** When the link stops working; null while the message has not gone out. */
  expiresAt: z.iso.datetime().nullable(),
});
export type InvitationResponse = z.infer<typeof InvitationSchema>;

export const InvitationPageSchema = pageOf(InvitationSchema);
