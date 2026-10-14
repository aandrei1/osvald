import { z } from 'zod';

import { characterSchema } from './character.js';
import { idSchema, isoDateTimeSchema } from './common.js';
import { sceneWithLinesSchema } from './scene.js';

/**
 * `status` drives the upload → parse → rehearsal flow:
 * `uploaded` (file stored, job not picked up yet) → `parsing` (worker running)
 * → `parsed` (scenes/lines written) or `failed` (see the job for details).
 */
export const scriptStatusSchema = z.enum(['uploaded', 'parsing', 'parsed', 'failed']);
export type ScriptStatus = z.infer<typeof scriptStatusSchema>;

export const scriptSchema = z.object({
  id: idSchema,
  /** Owner. `null` while anonymous sandbox scripts are allowed. */
  userId: idSchema.nullable(),
  title: z.string().min(1).max(300),
  author: z.string().max(300).nullable(),
  description: z.string().nullable(),
  status: scriptStatusSchema,
  /** Original file name of the uploaded PDF, if any. */
  sourceFileName: z.string().nullable(),
  /** Pages found in the source document, once the parser has opened it. */
  pageCount: z.number().int().positive().nullable(),
  /** Why the last parse attempt failed. `null` unless `status` is `failed`. */
  parseError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Script = z.infer<typeof scriptSchema>;

export const scriptDetailSchema = scriptSchema.extend({
  scenes: z.array(sceneWithLinesSchema),
  /** Cast of the whole script — the rehearsal view needs it to pick a role. */
  characters: z.array(characterSchema),
});
export type ScriptDetail = z.infer<typeof scriptDetailSchema>;

/* -------------------------------------------------------------------------- */
/* Route payloads                                                             */
/* -------------------------------------------------------------------------- */

export const scriptListResponseSchema = z.object({
  items: z.array(scriptSchema),
  total: z.number().int().nonnegative(),
});
export type ScriptListResponse = z.infer<typeof scriptListResponseSchema>;

export const createScriptBodySchema = z.object({
  title: z.string().min(1).max(300),
  author: z.string().max(300).nullable().optional(),
  description: z.string().nullable().optional(),
});
export type CreateScriptBody = z.infer<typeof createScriptBodySchema>;

/** Response of `POST /scripts/upload` — the stored script plus the queue job id. */
export const uploadScriptResponseSchema = z.object({
  script: scriptSchema,
  jobId: z.string(),
  queueName: z.string(),
});
export type UploadScriptResponse = z.infer<typeof uploadScriptResponseSchema>;
