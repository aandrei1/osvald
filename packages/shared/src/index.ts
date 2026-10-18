/**
 * @osvald/shared
 *
 * Single source of truth for the wire format: Zod schemas + inferred types.
 * Imported by `@osvald/backend` (Fastify request/response validation through
 * `fastify-type-provider-zod`) and by `@osvald/frontend` (typed API client).
 *
 * Build the package (`pnpm --filter @osvald/shared build`) before consuming it;
 * `pnpm dev` at the repo root keeps it in watch mode.
 */

export * from './common.js';
export * from './language.js';
export * from './line.js';
export * from './character.js';
export * from './scene.js';
export * from './script.js';
export * from './tts.js';
export * from './user.js';
export * from './health.js';

/**
 * Zod's schema type, re-exported so consumers (the frontend's API client, for
 * instance) can type "a schema that produces T" without depending on Zod
 * directly — this package stays the single owner of the schema layer.
 */
export type { ZodType } from 'zod';

// NOTE: the `Cheatsheet` domain (schema, table, routes, store) is intentionally
// deferred for now. When it lands, add `export * from './cheatsheet.js';` here
// along with the matching backend table/routes and frontend store.
