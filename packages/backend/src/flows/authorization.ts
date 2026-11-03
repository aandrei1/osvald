import { can, type WorkspacePermission, type WorkspaceRole } from '@osvald/shared';
import { and, eq } from 'drizzle-orm';

import type { Executor } from '../db/client.js';
import { scripts, type ScriptRow } from '../db/schema/scripts.js';
import { workspaceMembers } from '../db/schema/workspaces.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { findRole } from '../services/workspace.service.js';

/** Who issues a command. The role is always read from the database, never from the token. */
export interface Actor {
  userId: string;
}

function assertAllowed(role: WorkspaceRole, permission: WorkspacePermission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(`A workspace ${role} cannot do "${permission}"; ask the editor`);
  }
}

/**
 * The actor's role in the workspace, checked against `permission` from the
 * matrix in `@osvald/shared`.
 *
 * A non-member gets a 404, exactly like a missing workspace, so ids cannot be
 * probed. A member without the permission gets a 403: they already know the
 * workspace exists.
 */
export async function authorizeWorkspace(
  executor: Executor,
  actor: Actor,
  workspaceId: string,
  permission: WorkspacePermission,
): Promise<WorkspaceRole> {
  const role = await findRole(executor, actor.userId, workspaceId);

  if (role === null) {
    throw new NotFoundError('Workspace', workspaceId);
  }

  assertAllowed(role, permission);
  return role;
}

/** The script, if the actor's role in its workspace allows `permission`. Same 404/403 rule. */
export async function authorizeScript(
  executor: Executor,
  actor: Actor,
  scriptId: string,
  permission: WorkspacePermission,
): Promise<ScriptRow> {
  const [row] = await executor
    .select({ script: scripts, role: workspaceMembers.role })
    .from(scripts)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, scripts.workspaceId),
        eq(workspaceMembers.userId, actor.userId),
      ),
    )
    .where(eq(scripts.id, scriptId));

  if (row === undefined) {
    throw new NotFoundError('Script', scriptId);
  }

  assertAllowed(row.role, permission);
  return row.script;
}
