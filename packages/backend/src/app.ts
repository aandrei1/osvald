import { randomUUID } from 'node:crypto';

import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { corsOrigins, env } from './config/env.js';
import { createDatabase } from './db/client.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { createRedisClient } from './queue/connection.js';
import { createQueueRegistry } from './queue/queues.js';
import { registerRoutes } from './routes/index.js';

/**
 * Builds the Fastify instance: compilers, connections, plugins and routes.
 *
 * Kept separate from `src/index.ts` so tests can `await buildApp()` and use
 * `app.inject()` without binding a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // TODO(logging): pipe through pino-pretty in development.
    logger: { level: env.LOG_LEVEL },
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  // Zod validation + serialization for every route schema.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Postgres. postgres.js connects lazily, so boot does not depend on the DB.
  const database = createDatabase();
  app.decorate('db', database.db);
  app.addHook('onClose', async () => {
    await database.close();
  });

  // Redis, tuned for probes: fail fast instead of queueing commands forever.
  const redis = createRedisClient({
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: () => null,
  });
  redis.on('error', (error: Error) => {
    // Without a listener an ioredis 'error' event would crash the process.
    app.log.warn({ err: error }, 'redis error');
  });
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  });

  // BullMQ queues. Connections happen in the background.
  const queues = createQueueRegistry(app.log);
  app.decorate('queues', queues);
  app.addHook('onClose', async () => {
    await queues.close();
  });

  await app.register(fastifyCors, {
    origin: corsOrigins,
    credentials: true,
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: env.UPLOAD_MAX_BYTES,
      files: 1,
      fields: 10,
    },
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Osvald API',
        description: 'Rehearsal app for actors — scripts, scenes, lines, playback.',
        version: env.APP_VERSION,
      },
      tags: [
        { name: 'ops', description: 'Health and operational endpoints' },
        { name: 'scripts', description: 'Script upload and retrieval' },
        { name: 'auth', description: 'Accounts and tokens' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    // Schemas come from @osvald/shared, so the OpenAPI document is generated
    // straight from the Zod route schemas.
    transform: jsonSchemaTransform,
  });

  // @fastify/swagger v9 no longer exposes a spec route itself (that is
  // @fastify/swagger-ui's job), so serve the generated document here.
  // TODO(docs): add @fastify/swagger-ui for a browsable UI at /documentation.
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  registerErrorHandler(app);
  await registerAuth(app);

  await app.register(registerRoutes);

  return app;
}
