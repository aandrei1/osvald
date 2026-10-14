import { healthResponseSchema } from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { collectHealth } from '../services/health.service.js';

/**
 * GET /health — the end-to-end wiring example.
 *
 * The frontend calls this on app load (`services/api.ts` → `HealthStatusCard`),
 * Docker Compose uses it as the container healthcheck, and it reports Postgres,
 * Redis and OCR-service connectivity.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['ops'],
        summary: 'Service health',
        description:
          'Always answers 200 so the client can render the status; inspect `status` (`ok` | `degraded`) and the per-dependency entries.',
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => collectHealth({ db: app.db, redis: app.redis }),
  );
};
