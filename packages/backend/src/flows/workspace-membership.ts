import { createHash, randomBytes } from 'node:crypto';

import type {
  Invitation,
  InvitationPreview,
  InvitationSentResponse,
  WorkspaceMember,
  WorkspaceSummary,
} from '@osvald/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { Database, Executor } from '../db/client.js';
import { users } from '../db/schema/users.js';
import {
  invitations,
  type InvitationRow,
  workspaceMembers,
  workspaces,
} from '../db/schema/workspaces.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { Clock } from '../ports/clock.js';
import type { EmailSender } from '../ports/email-sender.js';
import { normalizeEmail } from '../services/user.service.js';
import {
  createWorkspace,
  getWorkspaceSummary,
  invitationStatus,
  listMembers,
  listWorkspaceSummaries,
  mapInvitationRow,
} from '../services/workspace.service.js';
import { authorizeWorkspace, type Actor } from './authorization.js';

export interface WorkspaceMembershipDeps {
  db: Database;
  emailSender: EmailSender;
  clock: Clock;
  logger: Logger;
  /** Where the app is served; the e-mail links to `<appBaseUrl>/invitations/<token>`. */
  appBaseUrl: string;
  invitationTtlMs: number;
  /** Token generator; tests pin it. */
  newToken?: () => string;
}

/** 32 random bytes, base64url: what `invitationTokenSchema` accepts. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash is stored, so a database leak does not hand out working links. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Workspaces, their members and invitations.
 *
 * Every command authorizes the actor against the permission matrix in
 * `@osvald/shared`, reading the role from the database. Each workspace has
 * exactly one editor: a partial unique index allows at most one, and the
 * commands below never leave it without one (the editor cannot be removed,
 * only replaced through `transferEditor`).
 */
export class WorkspaceMembership {
  private readonly db: Database;
  private readonly emailSender: EmailSender;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly appBaseUrl: string;
  private readonly invitationTtlMs: number;
  private readonly newToken: () => string;

  constructor(deps: WorkspaceMembershipDeps) {
    this.db = deps.db;
    this.emailSender = deps.emailSender;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.appBaseUrl = deps.appBaseUrl.replace(/\/+$/, '');
    this.invitationTtlMs = deps.invitationTtlMs;
    this.newToken = deps.newToken ?? randomToken;
  }

  /* ------------------------------------------------------------------------ */
  /* Workspaces                                                               */
  /* ------------------------------------------------------------------------ */

  async list(actor: Actor): Promise<WorkspaceSummary[]> {
    return listWorkspaceSummaries(this.db, actor.userId);
  }

  /** Anyone may create a workspace; they become its editor. */
  async create(actor: Actor, name: string): Promise<WorkspaceSummary> {
    return this.db.transaction(async (tx) => {
      const row = await createWorkspace(tx, {
        name,
        editorId: actor.userId,
        now: this.clock.now(),
      });
      return getWorkspaceSummary(tx, actor.userId, row.id);
    });
  }

  async rename(actor: Actor, workspaceId: string, name: string): Promise<WorkspaceSummary> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:rename');

    await this.db
      .update(workspaces)
      .set({ name, updatedAt: this.clock.now() })
      .where(eq(workspaces.id, workspaceId));

    return getWorkspaceSummary(this.db, actor.userId, workspaceId);
  }

  /* ------------------------------------------------------------------------ */
  /* Members                                                                  */
  /* ------------------------------------------------------------------------ */

  async listMembers(actor: Actor, workspaceId: string): Promise<WorkspaceMember[]> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:read');
    return listMembers(this.db, workspaceId);
  }

  /** The editor removes a member. The editor cannot remove themselves: they transfer the role first. */
  async removeMember(actor: Actor, workspaceId: string, userId: string): Promise<void> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:remove_member');

    if (userId === actor.userId) {
      throw new ConflictError('The editor cannot leave; transfer the editor role first');
    }

    const removed = await this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, 'member'),
        ),
      )
      .returning({ userId: workspaceMembers.userId });

    if (removed.length === 0) {
      throw new NotFoundError('Member', userId);
    }
  }

  /**
   * Hands the editor role to another member, atomically.
   *
   * The workspace row is locked first, so two transfers (the editor on two
   * devices) run one after the other: the second finds its actor demoted and
   * gets a 403. The demotion runs before the promotion because the partial
   * unique index allows one editor at any instant, not only at commit.
   */
  async transferEditor(
    actor: Actor,
    workspaceId: string,
    toUserId: string,
  ): Promise<WorkspaceMember[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for('update');

      await authorizeWorkspace(tx, actor, workspaceId, 'workspace:transfer_editor');

      if (toUserId === actor.userId) {
        throw new BadRequestError('You are already the editor');
      }

      const [target] = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, toUserId)),
        );

      if (target === undefined) {
        throw new NotFoundError('Member', toUserId);
      }

      await this.setRole(tx, workspaceId, actor.userId, 'member');
      await this.setRole(tx, workspaceId, toUserId, 'editor');

      return listMembers(tx, workspaceId);
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Invitations                                                              */
  /* ------------------------------------------------------------------------ */

  /** Open invitations (pending or expired), newest first. */
  async listInvitations(actor: Actor, workspaceId: string): Promise<Invitation[]> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:invite');

    const rows = await this.db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt));

    const now = this.clock.now();
    return rows.map((row) => mapInvitationRow(row, now));
  }

  /**
   * Invites an address and e-mails it a link.
   *
   * An open invitation to the same address is revoked, so only the newest link
   * works. The invitation is saved even when the e-mail fails; the answer then
   * says `emailSent: false` and the editor can send it again.
   */
  async invite(actor: Actor, workspaceId: string, email: string): Promise<InvitationSentResponse> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:invite');

    const address = normalizeEmail(email);
    const token = this.newToken();
    const now = this.clock.now();

    const { row, workspaceName, invitedBy } = await this.db.transaction(async (tx) => {
      // Two invites to the same address would race for the "one open
      // invitation" index; the lock makes the second one revoke the first.
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for('update');

      const [existingMember] = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, address)));

      if (existingMember !== undefined) {
        throw new ConflictError(`${address} is already a member of this workspace`);
      }

      await tx
        .update(invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.email, address),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );

      const [inserted] = await tx
        .insert(invitations)
        .values({
          workspaceId,
          email: address,
          tokenHash: hashInvitationToken(token),
          invitedBy: actor.userId,
          expiresAt: new Date(now.getTime() + this.invitationTtlMs),
          createdAt: now,
        })
        .returning();

      if (inserted === undefined) {
        throw new Error('Insert into "invitations" returned no row');
      }

      return {
        row: inserted,
        ...(await this.invitationContext(tx, workspaceId, actor.userId)),
      };
    });

    const emailSent = await this.sendInvitation(row, token, workspaceName, invitedBy);
    return { invitation: mapInvitationRow(row, now), emailSent };
  }

  /** A fresh link for an open invitation. The token is not stored, so the old link cannot be re-sent. */
  async resendInvitation(
    actor: Actor,
    workspaceId: string,
    invitationId: string,
  ): Promise<InvitationSentResponse> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:invite');
    const row = await this.openInvitation(workspaceId, invitationId);
    return this.invite(actor, workspaceId, row.email);
  }

  async revokeInvitation(actor: Actor, workspaceId: string, invitationId: string): Promise<void> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'workspace:invite');

    const revoked = await this.db
      .update(invitations)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.workspaceId, workspaceId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id });

    if (revoked.length === 0) {
      throw new NotFoundError('Invitation', invitationId);
    }
  }

  /** What the e-mail link shows. Needs no account: the token is the secret. */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const row = await this.invitationByToken(this.db, token);
    const { workspaceName, invitedBy } = await this.invitationContext(
      this.db,
      row.workspaceId,
      row.invitedBy,
    );

    return {
      workspaceName,
      invitedBy,
      email: row.email,
      status: invitationStatus(row, this.clock.now()),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Joins the workspace as a member.
   *
   * Only the account with the invited address may accept, so a forwarded link
   * gives nobody else access. The invitation row is locked, so two accepts of
   * the same link cannot both succeed; an accepted, revoked or expired one is
   * refused.
   */
  async acceptInvitation(actor: Actor, token: string): Promise<WorkspaceSummary> {
    return this.db.transaction(async (tx) => {
      const row = await this.invitationByToken(tx, token, { lock: true });
      const now = this.clock.now();

      const status = invitationStatus(row, now);
      if (status !== 'pending') {
        throw new ConflictError(
          `This invitation was ${status === 'accepted' ? 'already used' : status}`,
        );
      }

      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, actor.userId));

      if (user === undefined || user.email !== row.email) {
        throw new ForbiddenError(`This invitation is for ${row.email}; sign in with that address`);
      }

      await tx
        .update(invitations)
        .set({ acceptedAt: now, acceptedBy: actor.userId })
        .where(eq(invitations.id, row.id));

      // Someone already in the workspace keeps their role.
      await tx
        .insert(workspaceMembers)
        .values({
          workspaceId: row.workspaceId,
          userId: actor.userId,
          role: 'member',
          joinedAt: now,
        })
        .onConflictDoNothing();

      return getWorkspaceSummary(tx, actor.userId, row.workspaceId);
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Helpers                                                                  */
  /* ------------------------------------------------------------------------ */

  private async setRole(
    tx: Executor,
    workspaceId: string,
    userId: string,
    role: 'editor' | 'member',
  ): Promise<void> {
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
  }

  private async openInvitation(workspaceId: string, invitationId: string): Promise<InvitationRow> {
    const [row] = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId)));

    if (row === undefined || row.acceptedAt !== null || row.revokedAt !== null) {
      throw new NotFoundError('Invitation', invitationId);
    }

    return row;
  }

  private async invitationByToken(
    executor: Executor,
    token: string,
    options: { lock?: boolean } = {},
  ): Promise<InvitationRow> {
    const query = executor
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashInvitationToken(token)));
    const [row] = options.lock === true ? await query.for('update') : await query;

    if (row === undefined) {
      // The token is not echoed back: it is a secret.
      throw new NotFoundError('Invitation', 'from this link');
    }

    return row;
  }

  private async invitationContext(
    executor: Executor,
    workspaceId: string,
    inviterId: string | null,
  ): Promise<{ workspaceName: string; invitedBy: string }> {
    const [workspace] = await executor
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    const [inviter] =
      inviterId === null
        ? []
        : await executor
            .select({ email: users.email, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, inviterId));

    return {
      workspaceName: workspace?.name ?? 'a workspace',
      invitedBy: inviter?.displayName ?? inviter?.email ?? 'The editor',
    };
  }

  private async sendInvitation(
    row: InvitationRow,
    token: string,
    workspaceName: string,
    invitedBy: string,
  ): Promise<boolean> {
    const link = `${this.appBaseUrl}/invitations/${token}`;
    const expires = row.expiresAt.toISOString().slice(0, 10);

    try {
      await this.emailSender.send({
        to: row.email,
        subject: `${invitedBy} invited you to "${workspaceName}" on Osvald`,
        text: [
          `${invitedBy} invited you to rehearse with "${workspaceName}" on Osvald.`,
          '',
          `Open this link to join (sign in or create an account with ${row.email}):`,
          link,
          '',
          `The link works once and expires on ${expires}.`,
        ].join('\n'),
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `could not e-mail invitation ${row.id}; the editor can send it again`,
        error,
      );
      return false;
    }
  }
}
