import type {
  Invitation,
  InvitationStatus,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from '@osvald/shared';
import { and, asc, count, eq } from 'drizzle-orm';

import type { Executor } from '../db/client.js';
import { toIsoDateTime } from '../db/mappers.js';
import { users } from '../db/schema/users.js';
import {
  type InvitationRow,
  workspaceMembers,
  workspaces,
  type WorkspaceRow,
} from '../db/schema/workspaces.js';
import { NotFoundError } from '../lib/errors.js';

/* -------------------------------------------------------------------------- */
/* Row → DTO mapping                                                          */
/* -------------------------------------------------------------------------- */

export function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

export function invitationStatus(row: InvitationRow, now: Date): InvitationStatus {
  if (row.acceptedAt !== null) {
    return 'accepted';
  }
  if (row.revokedAt !== null) {
    return 'revoked';
  }
  return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}

export function mapInvitationRow(row: InvitationRow, now: Date): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    status: invitationStatus(row, now),
    expiresAt: toIsoDateTime(row.expiresAt),
    createdAt: toIsoDateTime(row.createdAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/** Same rule as migration `0005`: the display name, else the e-mail's local part. */
export function personalWorkspaceName(user: { displayName: string | null; email: string }): string {
  const name = user.displayName?.trim();
  const owner = name !== undefined && name.length > 0 ? name : (user.email.split('@')[0] ?? '');
  return `${owner}'s workspace`;
}

/** Creates a workspace with `editorId` as its editor. Run it inside a transaction. */
export async function createWorkspace(
  tx: Executor,
  input: { name: string; editorId: string; now: Date },
): Promise<WorkspaceRow> {
  const [row] = await tx
    .insert(workspaces)
    .values({
      name: input.name,
      createdBy: input.editorId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  if (row === undefined) {
    throw new Error('Insert into "workspaces" returned no row');
  }

  await tx.insert(workspaceMembers).values({
    workspaceId: row.id,
    userId: input.editorId,
    role: 'editor',
    joinedAt: input.now,
  });

  return row;
}

/** The user's role in the workspace, or `null` when they are not a member. */
export async function findRole(
  executor: Executor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await executor
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

  return row?.role ?? null;
}

/** Every workspace the user belongs to, with their role and the member count, by name. */
export async function listWorkspaceSummaries(
  executor: Executor,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const memberCounts = executor
    .select({ workspaceId: workspaceMembers.workspaceId, value: count().as('member_count') })
    .from(workspaceMembers)
    .groupBy(workspaceMembers.workspaceId)
    .as('member_counts');

  const rows = await executor
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
      memberCount: memberCounts.value,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(memberCounts, eq(memberCounts.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name), asc(workspaces.createdAt));

  return rows.map((row) => ({
    ...mapWorkspaceRow(row.workspace),
    role: row.role,
    memberCount: row.memberCount,
  }));
}

/** One workspace as `userId` sees it in their list. */
export async function getWorkspaceSummary(
  executor: Executor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceSummary> {
  const summary = (await listWorkspaceSummaries(executor, userId)).find(
    (workspace) => workspace.id === workspaceId,
  );

  if (summary === undefined) {
    throw new NotFoundError('Workspace', workspaceId);
  }

  return summary;
}

/** Members, the editor first, then by when they joined. */
export async function listMembers(
  executor: Executor,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const rows = await executor
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.role), asc(workspaceMembers.joinedAt));

  return rows.map((row) => ({ ...row, joinedAt: toIsoDateTime(row.joinedAt) }));
}
