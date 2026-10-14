import {
  apiErrorSchema,
  authResponseSchema,
  loginBodySchema,
  meResponseSchema,
  registerBodySchema,
  type AuthResponse,
} from '@osvald/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import {
  findUserById,
  mapUserRow,
  registerUser,
  verifyCredentials,
} from '../../services/user.service.js';
import type { UserRow } from '../../db/schema/users.js';

/**
 * `/auth` routes.
 *
 * Tokens are short-lived bearer JWTs signed with `JWT_SECRET`; the claims are
 * the minimum the API needs (`sub`, `email`) — everything else is read from the
 * database on each request, so a stale token cannot carry stale authorisation.
 */

/** `JWT_EXPIRES_IN` is a duration string (`1h`); clients need seconds. */
function expiresInSeconds(duration: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(duration.trim());

  if (match === null) {
    // An unparseable value is a configuration slip, not a request error; report
    // the default rather than failing the login.
    return 3600;
  }

  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? 's'] ?? 1;

  return amount * multiplier;
}

function issueToken(app: FastifyInstance, user: UserRow): AuthResponse {
  return {
    user: mapUserRow(user),
    accessToken: app.jwt.sign({ sub: user.id, email: user.email }),
    expiresIn: expiresInSeconds(env.JWT_EXPIRES_IN),
  };
}

export const authRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: registerBodySchema,
        response: {
          201: authResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await registerUser(app.db, {
        email: request.body.email,
        password: request.body.password,
        displayName: request.body.displayName ?? null,
      });

      request.log.info({ userId: user.id }, 'account created');

      // TODO(auth): send a verification e-mail before granting a token.
      return reply.status(201).send(issueToken(app, user));
    },
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for an access token',
        body: loginBodySchema,
        response: {
          200: authResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request) => {
      // TODO(auth): add @fastify/rate-limit here before this is public — this
      // endpoint is the obvious brute-force target.
      const user = await verifyCredentials(app.db, request.body.email, request.body.password);

      return issueToken(app, user);
    },
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current user',
        security: [{ bearerAuth: [] }],
        response: {
          200: meResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const user = await findUserById(app.db, request.user.sub);

      if (user === null) {
        // A valid signature for a deleted account.
        throw new UnauthorizedError('This account no longer exists');
      }

      return { user: mapUserRow(user) };
    },
  );

  /*
   * TODO(auth): POST /auth/refresh (rotating refresh tokens), POST /auth/logout
   * (revocation), POST /auth/password-reset.
   */
};
