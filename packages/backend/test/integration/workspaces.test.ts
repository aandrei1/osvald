import {
  acceptInvitationResponseSchema,
  apiErrorSchema,
  authResponseSchema,
  invitationListResponseSchema,
  invitationPreviewSchema,
  invitationSentResponseSchema,
  workspaceListResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceSummarySchema,
} from '@osvald/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { workspaceMembers } from '../../src/db/schema/workspaces.js';
import {
  bearer,
  createTestApp,
  createTestUser,
  type TestApp,
  type TestUser,
} from '../helpers/app.js';
import { addMember, tryCreateTestDatabase } from '../helpers/database.js';
import { createFakeClock, invitationTokenFrom } from '../helpers/fakes.js';

/**
 * Workspaces, roles and invitations, through the HTTP routes.
 *
 * The rules pinned here come from `docs/plans/script-production-flow.md`: one
 * editor per workspace, members only read, permissions checked on the server,
 * and an invitation link that only the invited address can use, once.
 */

const database = await tryCreateTestDatabase();

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database?.truncate();
});

function db(): Database {
  if (database === null) {
    throw new Error('test database unavailable');
  }
  return database.db;
}

async function invite(test: TestApp, editor: TestUser, email: string) {
  const response = await test.app.inject({
    method: 'POST',
    url: `/workspaces/${editor.workspaceId}/invitations`,
    headers: bearer(editor.token),
    payload: { email },
  });
  const sent = response.statusCode === 201 && response.json<{ emailSent: boolean }>().emailSent;
  return { response, token: sent ? invitationTokenFrom(test.emails.sent.at(-1)) : '' };
}

async function accept(test: TestApp, user: TestUser, token: string) {
  return test.app.inject({
    method: 'POST',
    url: `/invitations/${token}/accept`,
    headers: bearer(user.token),
  });
}

async function roles(workspaceId: string): Promise<Record<string, string>> {
  const rows = await db()
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return Object.fromEntries(rows.map((row) => [row.userId, row.role]));
}

describe.skipIf(database === null)('workspaces', () => {
  describe('workspaces and roles', () => {
    it('gives a new account a personal workspace in which it is the editor', async () => {
      const test = await createTestApp(db());

      try {
        const registered = await test.app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: { email: 'ana@example.com', password: 'a long password', displayName: 'Ana' },
        });
        const { accessToken } = authResponseSchema.parse(registered.json());

        const response = await test.app.inject({
          method: 'GET',
          url: '/workspaces',
          headers: bearer(accessToken),
        });

        expect(response.statusCode).toBe(200);
        const { items } = workspaceListResponseSchema.parse(response.json());
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: "Ana's workspace", role: 'editor', memberCount: 1 });
      } finally {
        await test.close();
      }
    });

    it('makes the creator of a workspace its editor', async () => {
      const test = await createTestApp(db());

      try {
        const user = await createTestUser(test.app, db());

        const created = await test.app.inject({
          method: 'POST',
          url: '/workspaces',
          headers: bearer(user.token),
          payload: { name: '  Teatrul Mic  ' },
        });

        expect(created.statusCode).toBe(201);
        expect(workspaceSummarySchema.parse(created.json())).toMatchObject({
          name: 'Teatrul Mic',
          role: 'editor',
          memberCount: 1,
        });
      } finally {
        await test.close();
      }
    });

    it('lets only the editor rename, and hides the workspace from strangers', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        const stranger = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);

        const rename = (user: TestUser) =>
          test.app.inject({
            method: 'PATCH',
            url: `/workspaces/${editor.workspaceId}`,
            headers: bearer(user.token),
            payload: { name: 'Salem' },
          });

        expect((await rename(member)).statusCode).toBe(403);
        expect((await rename(stranger)).statusCode).toBe(404);

        const renamed = await rename(editor);
        expect(renamed.statusCode).toBe(200);
        expect(workspaceSummarySchema.parse(renamed.json()).name).toBe('Salem');
      } finally {
        await test.close();
      }
    });

    it('refuses every editor action to a member', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);
        const base = `/workspaces/${editor.workspaceId}`;

        const actions = [
          { method: 'GET', url: `${base}/invitations` },
          { method: 'POST', url: `${base}/invitations`, payload: { email: 'x@example.com' } },
          { method: 'POST', url: `${base}/editor`, payload: { userId: member.id } },
          { method: 'DELETE', url: `${base}/members/${editor.id}` },
        ] as const;

        for (const action of actions) {
          const response = await test.app.inject({ ...action, headers: bearer(member.token) });
          expect(response.statusCode, `${action.method} ${action.url}`).toBe(403);
        }

        const members = await test.app.inject({
          method: 'GET',
          url: `${base}/members`,
          headers: bearer(member.token),
        });
        expect(members.statusCode).toBe(200);
        expect(test.emails.sent).toHaveLength(0);
      } finally {
        await test.close();
      }
    });
  });

  describe('one editor per workspace', () => {
    it('hands the editor role over atomically', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);

        const response = await test.app.inject({
          method: 'POST',
          url: `/workspaces/${editor.workspaceId}/editor`,
          headers: bearer(editor.token),
          payload: { userId: member.id },
        });

        expect(response.statusCode).toBe(200);
        const { items } = workspaceMemberListResponseSchema.parse(response.json());
        expect(items.map((item) => [item.userId, item.role])).toEqual([
          [member.id, 'editor'],
          [editor.id, 'member'],
        ]);

        // The former editor is now a member like any other.
        const again = await test.app.inject({
          method: 'POST',
          url: `/workspaces/${editor.workspaceId}/editor`,
          headers: bearer(editor.token),
          payload: { userId: member.id },
        });
        expect(again.statusCode).toBe(403);
      } finally {
        await test.close();
      }
    });

    it('only hands the role to someone already in the workspace', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const stranger = await createTestUser(test.app, db());

        const response = await test.app.inject({
          method: 'POST',
          url: `/workspaces/${editor.workspaceId}/editor`,
          headers: bearer(editor.token),
          payload: { userId: stranger.id },
        });

        expect(response.statusCode).toBe(404);
        expect(await roles(editor.workspaceId)).toEqual({ [editor.id]: 'editor' });
      } finally {
        await test.close();
      }
    });

    it('keeps one editor when two transfers race', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const first = await createTestUser(test.app, db());
        const second = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, first.id);
        await addMember(db(), editor.workspaceId, second.id);

        // The editor on two devices, handing the role to two different people.
        const responses = await Promise.all(
          [first, second].map((target) =>
            test.app.inject({
              method: 'POST',
              url: `/workspaces/${editor.workspaceId}/editor`,
              headers: bearer(editor.token),
              payload: { userId: target.id },
            }),
          ),
        );

        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
        const editors = Object.values(await roles(editor.workspaceId)).filter(
          (role) => role === 'editor',
        );
        expect(editors).toHaveLength(1);
      } finally {
        await test.close();
      }
    });

    it('rejects a second editor at the database', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);

        await expect(
          db()
            .update(workspaceMembers)
            .set({ role: 'editor' })
            .where(
              and(
                eq(workspaceMembers.workspaceId, editor.workspaceId),
                eq(workspaceMembers.userId, member.id),
              ),
            ),
        ).rejects.toThrow();
      } finally {
        await test.close();
      }
    });

    it('lets the editor remove a member but not themselves', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);
        const base = `/workspaces/${editor.workspaceId}/members`;

        const self = await test.app.inject({
          method: 'DELETE',
          url: `${base}/${editor.id}`,
          headers: bearer(editor.token),
        });
        expect(self.statusCode).toBe(409);

        const removed = await test.app.inject({
          method: 'DELETE',
          url: `${base}/${member.id}`,
          headers: bearer(editor.token),
        });
        expect(removed.statusCode).toBe(204);

        const afterwards = await test.app.inject({
          method: 'GET',
          url: `/scripts?workspaceId=${editor.workspaceId}`,
          headers: bearer(member.token),
        });
        expect(afterwards.statusCode).toBe(404);
      } finally {
        await test.close();
      }
    });
  });

  describe('invitations', () => {
    it('e-mails a link that the invited account accepts as a member', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'Ioana@Example.com' });

        const { response, token } = await invite(test, editor, 'IOANA@example.com');
        expect(response.statusCode).toBe(201);
        const sent = invitationSentResponseSchema.parse(response.json());
        expect(sent).toMatchObject({
          emailSent: true,
          invitation: { email: 'ioana@example.com', status: 'pending' },
        });
        expect(test.emails.sent[0]?.to).toBe('ioana@example.com');
        expect(test.emails.sent[0]?.text).toContain(`http://localhost:5173/invitations/${token}`);

        const preview = await test.app.inject({ method: 'GET', url: `/invitations/${token}` });
        expect(preview.statusCode).toBe(200);
        expect(invitationPreviewSchema.parse(preview.json())).toMatchObject({
          email: 'ioana@example.com',
          status: 'pending',
          invitedBy: 'Test Actor',
        });

        const accepted = await accept(test, invitee, token);
        expect(accepted.statusCode).toBe(200);
        expect(acceptInvitationResponseSchema.parse(accepted.json()).workspace).toMatchObject({
          id: editor.workspaceId,
          role: 'member',
          memberCount: 2,
        });
        expect(await roles(editor.workspaceId)).toEqual({
          [editor.id]: 'editor',
          [invitee.id]: 'member',
        });
      } finally {
        await test.close();
      }
    });

    it('works only once', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'ioana@example.com' });
        const { token } = await invite(test, editor, invitee.email);

        expect((await accept(test, invitee, token)).statusCode).toBe(200);

        const reused = await accept(test, invitee, token);
        expect(reused.statusCode).toBe(409);
        expect(apiErrorSchema.parse(reused.json()).message).toContain('already used');
      } finally {
        await test.close();
      }
    });

    it('lets two simultaneous accepts of one link succeed only once', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'ioana@example.com' });
        const { token } = await invite(test, editor, invitee.email);

        const responses = await Promise.all([
          accept(test, invitee, token),
          accept(test, invitee, token),
        ]);

        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      } finally {
        await test.close();
      }
    });

    it('refuses an account with another e-mail address', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const someoneElse = await createTestUser(test.app, db(), { email: 'other@example.com' });
        const { token } = await invite(test, editor, 'ioana@example.com');

        const response = await accept(test, someoneElse, token);

        expect(response.statusCode).toBe(403);
        expect(apiErrorSchema.parse(response.json()).message).toContain('ioana@example.com');
        expect(Object.keys(await roles(editor.workspaceId))).toEqual([editor.id]);
      } finally {
        await test.close();
      }
    });

    it('refuses an expired link', async () => {
      const clock = createFakeClock();
      const test = await createTestApp(db(), { clock });

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'ioana@example.com' });
        const { token } = await invite(test, editor, invitee.email);

        clock.advance(7 * 24 * 60 * 60 * 1000);

        const preview = await test.app.inject({ method: 'GET', url: `/invitations/${token}` });
        expect(invitationPreviewSchema.parse(preview.json()).status).toBe('expired');

        const response = await accept(test, invitee, token);
        expect(response.statusCode).toBe(409);
        expect(apiErrorSchema.parse(response.json()).message).toContain('expired');
      } finally {
        await test.close();
      }
    });

    it('refuses a revoked link, and a link replaced by a newer invitation', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'ioana@example.com' });

        const { response, token: revokedToken } = await invite(test, editor, invitee.email);
        const { invitation } = invitationSentResponseSchema.parse(response.json());
        const revoked = await test.app.inject({
          method: 'DELETE',
          url: `/workspaces/${editor.workspaceId}/invitations/${invitation.id}`,
          headers: bearer(editor.token),
        });
        expect(revoked.statusCode).toBe(204);
        expect((await accept(test, invitee, revokedToken)).statusCode).toBe(409);

        const { token: oldToken } = await invite(test, editor, invitee.email);
        const { token: newToken } = await invite(test, editor, invitee.email);
        expect((await accept(test, invitee, oldToken)).statusCode).toBe(409);
        expect((await accept(test, invitee, newToken)).statusCode).toBe(200);
      } finally {
        await test.close();
      }
    });

    it('answers 404 for a link that never existed', async () => {
      const test = await createTestApp(db());

      try {
        const user = await createTestUser(test.app, db());
        const token = 'x'.repeat(43);

        expect(
          (await test.app.inject({ method: 'GET', url: `/invitations/${token}` })).statusCode,
        ).toBe(404);
        expect((await accept(test, user, token)).statusCode).toBe(404);
      } finally {
        await test.close();
      }
    });

    it('keeps the invitation when the e-mail fails, and sends a fresh link on resend', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const invitee = await createTestUser(test.app, db(), { email: 'ioana@example.com' });

        test.emails.failNext();
        const { response } = await invite(test, editor, invitee.email);
        expect(response.statusCode).toBe(201);
        const failed = invitationSentResponseSchema.parse(response.json());
        expect(failed.emailSent).toBe(false);
        expect(test.emails.sent).toHaveLength(0);

        const listed = await test.app.inject({
          method: 'GET',
          url: `/workspaces/${editor.workspaceId}/invitations`,
          headers: bearer(editor.token),
        });
        expect(
          invitationListResponseSchema.parse(listed.json()).items.map((item) => item.id),
        ).toEqual([failed.invitation.id]);

        const resent = await test.app.inject({
          method: 'POST',
          url: `/workspaces/${editor.workspaceId}/invitations/${failed.invitation.id}/resend`,
          headers: bearer(editor.token),
        });
        expect(resent.statusCode).toBe(201);
        expect(invitationSentResponseSchema.parse(resent.json()).emailSent).toBe(true);

        const token = invitationTokenFrom(test.emails.sent.at(-1));
        expect((await accept(test, invitee, token)).statusCode).toBe(200);
      } finally {
        await test.close();
      }
    });

    it('does not invite someone who is already a member', async () => {
      const test = await createTestApp(db());

      try {
        const editor = await createTestUser(test.app, db());
        const member = await createTestUser(test.app, db());
        await addMember(db(), editor.workspaceId, member.id);

        const { response } = await invite(test, editor, member.email);

        expect(response.statusCode).toBe(409);
        expect(test.emails.sent).toHaveLength(0);
      } finally {
        await test.close();
      }
    });
  });
});
