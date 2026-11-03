import {
  apiErrorSchema,
  createInvitationBodySchema,
  createWorkspaceBodySchema,
  idParamsSchema,
  invitationListResponseSchema,
  invitationParamsSchema,
  invitationSentResponseSchema,
  noContentSchema,
  renameWorkspaceBodySchema,
  transferEditorBodySchema,
  workspaceListResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberParamsSchema,
  workspaceSummarySchema,
} from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `/workspaces` routes: workspaces, members and the invitations an editor sends.
 *
 * Thin like the script routes: each validates the request and calls one
 * command of `WorkspaceMembership` (`app.workspaces`), which checks the
 * caller's role on the server. A non-member gets 404, a member without the
 * permission 403.
 */
export const workspaceRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['workspaces'],
        summary: "The caller's workspaces, with their role in each",
        security: [{ bearerAuth: [] }],
        response: {
          200: workspaceListResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request) => ({ items: await app.workspaces.list({ userId: request.user.sub }) }),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Create a workspace',
        description: 'The caller becomes its editor.',
        security: [{ bearerAuth: [] }],
        body: createWorkspaceBodySchema,
        response: {
          201: workspaceSummarySchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const workspace = await app.workspaces.create(
        { userId: request.user.sub },
        request.body.name,
      );
      return reply.status(201).send(workspace);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Rename a workspace',
        description: 'Editor only.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: renameWorkspaceBodySchema,
        response: {
          200: workspaceSummarySchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) =>
      app.workspaces.rename({ userId: request.user.sub }, request.params.id, request.body.name),
  );

  app.get(
    '/:id/members',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Members of a workspace, the editor first',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: workspaceMemberListResponseSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      items: await app.workspaces.listMembers({ userId: request.user.sub }, request.params.id),
    }),
  );

  app.delete(
    '/:id/members/:userId',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Remove a member',
        description:
          'Editor only. The editor cannot remove themselves; they transfer the role first.',
        security: [{ bearerAuth: [] }],
        params: workspaceMemberParamsSchema,
        response: {
          204: noContentSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await app.workspaces.removeMember(
        { userId: request.user.sub },
        request.params.id,
        request.params.userId,
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/:id/editor',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Hand the editor role to another member',
        description:
          'Editor only. Atomic: the caller becomes a member and the target the editor, in one transaction.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: transferEditorBodySchema,
        response: {
          200: workspaceMemberListResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      items: await app.workspaces.transferEditor(
        { userId: request.user.sub },
        request.params.id,
        request.body.userId,
      ),
    }),
  );

  app.get(
    '/:id/invitations',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Open invitations (pending or expired)',
        description: 'Editor only.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: invitationListResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      items: await app.workspaces.listInvitations({ userId: request.user.sub }, request.params.id),
    }),
  );

  app.post(
    '/:id/invitations',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Invite an e-mail address',
        description:
          'Editor only. Replaces any open invitation to the same address. The invitation is saved even when the e-mail fails (`emailSent: false`).',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: createInvitationBodySchema,
        response: {
          201: invitationSentResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const sent = await app.workspaces.invite(
        { userId: request.user.sub },
        request.params.id,
        request.body.email,
      );
      return reply.status(201).send(sent);
    },
  );

  app.post(
    '/:id/invitations/:invitationId/resend',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Send an open invitation again, with a fresh link',
        description: 'Editor only. The previous link stops working.',
        security: [{ bearerAuth: [] }],
        params: invitationParamsSchema,
        response: {
          201: invitationSentResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const sent = await app.workspaces.resendInvitation(
        { userId: request.user.sub },
        request.params.id,
        request.params.invitationId,
      );
      return reply.status(201).send(sent);
    },
  );

  app.delete(
    '/:id/invitations/:invitationId',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'Revoke an open invitation',
        description: 'Editor only. Its link stops working at once.',
        security: [{ bearerAuth: [] }],
        params: invitationParamsSchema,
        response: {
          204: noContentSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await app.workspaces.revokeInvitation(
        { userId: request.user.sub },
        request.params.id,
        request.params.invitationId,
      );
      return reply.status(204).send(null);
    },
  );
};
