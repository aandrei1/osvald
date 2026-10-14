import { z } from 'zod';

/**
 * Primitive shapes reused by every domain schema.
 *
 * Convention: everything that crosses the HTTP boundary is JSON-friendly —
 * IDs are UUID strings and timestamps are ISO-8601 UTC strings, even though the
 * database stores real `uuid` / `timestamptz` values.
 */

export const idSchema = z.uuid();
export type Id = z.infer<typeof idSchema>;

/** ISO-8601 UTC timestamp, e.g. `2026-09-21T12:00:00.000Z`. */
export const isoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/** Row timestamps shared by every table. */
export const timestampsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Timestamps = z.infer<typeof timestampsSchema>;

/** Standard `limit`/`offset` query parameters. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Error body returned by the API for every non-2xx response. */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  details: z.array(fieldErrorSchema).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Route params containing a single resource id. */
export const idParamsSchema = z.object({
  id: idSchema,
});
export type IdParams = z.infer<typeof idParamsSchema>;

/**
 * Body of a `204 No Content` response.
 *
 * Declared here so both sides agree that these routes answer with nothing: the
 * backend validates it as the response schema, and the client parses with it.
 */
export const noContentSchema = z.null();
