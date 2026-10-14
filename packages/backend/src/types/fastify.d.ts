import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

import type { Database } from '../db/client.js';
import type { AccessTokenPayload } from '../lib/auth.js';
import type { QueueRegistry } from '../queue/queues.js';

/**
 * Module augmentation: everything `buildApp()` decorates the Fastify instance
 * with, plus the JWT payload/user shape.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle client (see `src/db/client.ts`). */
    db: Database;
    /** BullMQ queues (see `src/queue/queues.ts`). */
    queues: QueueRegistry;
    /** Redis client used for probes and future caching/pub-sub work. */
    redis: Redis;
    /** `preHandler` that rejects unauthenticated requests with 401. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}
