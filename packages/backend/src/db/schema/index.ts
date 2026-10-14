/**
 * Schema barrel — this is the `schema` passed to `drizzle()` and the entry
 * point drizzle-kit reads (see `drizzle.config.ts`).
 */

export * from './users.js';
export * from './scripts.js';
export * from './scenes.js';
export * from './characters.js';
export * from './lines.js';

// Relations must be imported so drizzle registers them.
export * from './relations.js';
