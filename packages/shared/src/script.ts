import { z } from 'zod';

import { characterSchema } from './character.js';
import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common.js';
import { sceneWithLinesSchema } from './scene.js';
import { scriptStageSchema } from './script-stage.js';

export const scriptSchema = z.object({
  id: idSchema,
  /** The workspace whose members can read and rehearse it. */
  workspaceId: idSchema,
  /** Who uploaded it. `null` once that account is gone. */
  userId: idSchema.nullable(),
  title: z.string().min(1).max(300),
  author: z.string().max(300).nullable(),
  description: z.string().nullable(),
  /** Where the script is in its production flow; see `script-stage.ts`. */
  stage: scriptStageSchema,
  /** When the script entered `stage`, e.g. to tell how long extraction has run. */
  stageEnteredAt: isoDateTimeSchema,
  /** Original file name of the uploaded PDF, if any. */
  sourceFileName: z.string().nullable(),
  /** Pages found in the source document, once the parser has opened it. */
  pageCount: z.number().int().positive().nullable(),
  /** Why the last extraction failed. `null` unless `stage` is `failed`. */
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

/** Query of `GET /scripts`: one workspace's library, a page at a time. */
export const scriptListQuerySchema = paginationQuerySchema.extend({
  workspaceId: idSchema,
});
export type ScriptListQuery = z.infer<typeof scriptListQuerySchema>;

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

/**
 * Answer of every flow command (upload, reparse, …): the script in its new
 * stage. Commands answer as soon as the stage is saved, not when the work ends.
 */
export const stageChangedResponseSchema = z.object({
  script: scriptSchema,
});
export type StageChangedResponse = z.infer<typeof stageChangedResponseSchema>;
