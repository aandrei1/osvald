import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';

import { env } from '../config/env.js';

/**
 * JWT wiring.
 *
 * Registers `@fastify/jwt` (which is fastify-plugin wrapped, so `app.jwt` and
 * `request.jwtVerify()` land on the root instance) and decorates
 * `app.authenticate` — the `preHandler` protected routes use:
 *
 *   app.get('/me', { preHandler: [app.authenticate] }, handler)
 *
 * The payload/user shape is declared in `src/types/fastify.d.ts`.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      // TODO(auth): distinguish expired vs malformed tokens so the client can
      // decide between "refresh" and "log in again".
      await reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing or invalid bearer token',
      });
    }
  });
}
