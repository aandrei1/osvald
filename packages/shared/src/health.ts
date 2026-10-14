import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';

/**
 * `GET /health` payload — used by the frontend on app load, and by Docker
 * healthchecks. Reports connectivity of the backing services without failing
 * the request (a degraded dependency yields `status: "degraded"`).
 */

export const dependencyStatusSchema = z.enum(['up', 'down', 'unknown']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthDependencySchema = z.object({
  name: z.enum(['database', 'redis', 'ocrService']),
  status: dependencyStatusSchema,
  latencyMs: z.number().nonnegative().nullable(),
  message: z.string().nullable(),
});
export type HealthDependency = z.infer<typeof healthDependencySchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: isoDateTimeSchema,
  dependencies: z.array(healthDependencySchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
