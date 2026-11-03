import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';

/**
 * Workspaces group the people who rehearse the same scripts.
 *
 * Each workspace has exactly one `editor` (the coordinator), who imports and
 * prepares scripts and manages the members. Everyone else is a `member` who
 * reads and rehearses. The editor role moves only through an atomic transfer.
 */
export const WORKSPACE_ROLES = ['editor', 'member'] as const;
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/* -------------------------------------------------------------------------- */
/* Permissions                                                                */
/* -------------------------------------------------------------------------- */

export const WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:rename',
  'workspace:invite',
  'workspace:remove_member',
  'workspace:transfer_editor',
  'script:read',
  'script:import',
  'script:reparse',
  'script:delete',
  'script:edit',
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

/**
 * The permission matrix, defined once for the backend (which enforces it on
 * every command) and the frontend (which only uses it to hide buttons).
 *
 * Members do not change voices or text: a changed Azure voice means the audio
 * has to be generated again.
 *
 * TODO: [Etapa 4] Add `script:synthesize` for submit, stop and resume.
 */
export const ROLE_PERMISSIONS = {
  editor: WORKSPACE_PERMISSIONS,
  member: ['workspace:read', 'script:read'],
} as const satisfies Record<WorkspaceRole, readonly WorkspacePermission[]>;

/** Whether `role` grants `permission`. */
export function can(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly WorkspacePermission[]).includes(permission);
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

export const workspaceNameSchema = z.string().trim().min(1).max(120);

export const workspaceSchema = z.object({
  id: idSchema,
  name: workspaceNameSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** A workspace as one of its members sees it in their list. */
export const workspaceSummarySchema = workspaceSchema.extend({
  /** The caller's role here. */
  role: workspaceRoleSchema,
  memberCount: z.number().int().positive(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const workspaceMemberSchema = z.object({
  userId: idSchema,
  email: z.email(),
  displayName: z.string().nullable(),
  role: workspaceRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/**
 * `pending` until someone accepts it; `revoked` by the editor, or replaced by
 * a newer invitation to the same address; `expired` once `expiresAt` passes.
 */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const invitationStatusSchema = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/** An invitation as the editor sees it. The token never leaves the e-mail. */
export const invitationSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  email: z.email(),
  status: invitationStatusSchema,
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type Invitation = z.infer<typeof invitationSchema>;

/** What the link in the e-mail shows before the invitee accepts. */
export const invitationPreviewSchema = z.object({
  workspaceName: workspaceNameSchema,
  /** Display name or e-mail of the editor who sent it. */
  invitedBy: z.string(),
  email: z.email(),
  status: invitationStatusSchema,
  expiresAt: isoDateTimeSchema,
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/* -------------------------------------------------------------------------- */
/* Route payloads                                                             */
/* -------------------------------------------------------------------------- */

/** `?workspaceId=` on routes that act inside one workspace, such as the upload. */
export const workspaceIdQuerySchema = z.object({
  workspaceId: idSchema,
});
export type WorkspaceIdQuery = z.infer<typeof workspaceIdQuerySchema>;

export const workspaceListResponseSchema = z.object({
  items: z.array(workspaceSummarySchema),
});
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;

export const createWorkspaceBodySchema = z.object({
  name: workspaceNameSchema,
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const renameWorkspaceBodySchema = z.object({
  name: workspaceNameSchema,
});
export type RenameWorkspaceBody = z.infer<typeof renameWorkspaceBodySchema>;

export const workspaceMemberListResponseSchema = z.object({
  items: z.array(workspaceMemberSchema),
});
export type WorkspaceMemberListResponse = z.infer<typeof workspaceMemberListResponseSchema>;

export const workspaceMemberParamsSchema = z.object({
  id: idSchema,
  userId: idSchema,
});
export type WorkspaceMemberParams = z.infer<typeof workspaceMemberParamsSchema>;

/** Body of `POST /workspaces/:id/editor`: the member who becomes the editor. */
export const transferEditorBodySchema = z.object({
  userId: idSchema,
});
export type TransferEditorBody = z.infer<typeof transferEditorBodySchema>;

export const createInvitationBodySchema = z.object({
  email: z.email(),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

/**
 * The invitation is saved even when the e-mail could not be sent; the editor
 * can then send it again.
 */
export const invitationSentResponseSchema = z.object({
  invitation: invitationSchema,
  emailSent: z.boolean(),
});
export type InvitationSentResponse = z.infer<typeof invitationSentResponseSchema>;

export const invitationListResponseSchema = z.object({
  items: z.array(invitationSchema),
});
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;

export const invitationParamsSchema = z.object({
  id: idSchema,
  invitationId: idSchema,
});
export type InvitationParams = z.infer<typeof invitationParamsSchema>;

/** The secret from the e-mail link: 32 random bytes, base64url. */
export const invitationTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const invitationTokenParamsSchema = z.object({
  token: invitationTokenSchema,
});
export type InvitationTokenParams = z.infer<typeof invitationTokenParamsSchema>;

export const acceptInvitationResponseSchema = z.object({
  workspace: workspaceSummarySchema,
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
