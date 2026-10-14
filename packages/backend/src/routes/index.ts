import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authRoutes } from './auth/index.js';
import { healthRoutes } from './health.js';
import { scriptRoutes } from './scripts/index.js';

/**
 * Route tree. One module per resource, each mounted under its own prefix so
 * the route files can stay relative.
 *
 * TODO(cheatsheets): add `cheatsheetsRoutes` under `/cheatsheets` — the whole
 * cheatsheet domain (shared schema, table, routes, Pinia store) is deferred.
 */
export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(healthRoutes);
  await app.register(scriptRoutes, { prefix: '/scripts' });
  await app.register(authRoutes, { prefix: '/auth' });
};
