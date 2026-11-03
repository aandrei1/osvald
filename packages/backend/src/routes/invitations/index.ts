import {
  acceptInvitationResponseSchema,
  apiErrorSchema,
  invitationPreviewSchema,
  invitationTokenParamsSchema,
} from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `/invitations/:token` routes: what the link in the e-mail opens.
 *
 * The preview needs no account, so someone without one can see what they were
 * invited to before signing up. Accepting needs the account whose e-mail
 * address was invited.
 */
export const invitationRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  app.get(
    '/:token',
    {
      schema: {
        tags: ['workspaces'],
        summary: 'What an invitation link is for',
        params: invitationTokenParamsSchema,
        response: {
          200: invitationPreviewSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => app.workspaces.previewInvitation(request.params.token),
  );

  app.post(
    '/:token/accept',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['workspaces'],
        summary: 'Join the workspace as a member',
        description:
          'Only the account with the invited e-mail address may accept (403 otherwise). A link works once: an accepted, revoked or expired invitation answers 409.',
        security: [{ bearerAuth: [] }],
        params: invitationTokenParamsSchema,
        response: {
          200: acceptInvitationResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      workspace: await app.workspaces.acceptInvitation(
        { userId: request.user.sub },
        request.params.token,
      ),
    }),
  );
};
