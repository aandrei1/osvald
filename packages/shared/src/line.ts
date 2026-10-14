import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';

/**
 * A `Line` is the smallest unit of a script: either spoken text or a stage
 * direction. Both variants share one row shape so playback and cheatsheets can
 * walk a single ordered list.
 */

export const lineTypeSchema = z.enum(['dialogue', 'direction']);
export type LineType = z.infer<typeof lineTypeSchema>;

export const lineSchema = z.object({
  id: idSchema,
  sceneId: idSchema,
  /** Speaking character. `null` for `direction` lines and for unassigned speakers. */
  characterId: idSchema.nullable(),
  /** 0-based position of the line inside its scene. */
  orderIndex: z.number().int().nonnegative(),
  type: lineTypeSchema,
  /** Name exactly as printed in the source PDF, e.g. `HAMLET` or `1st GRAVEDIGGER`. */
  speakerLabel: z.string().nullable(),
  text: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Line = z.infer<typeof lineSchema>;

/** Payload accepted when manually creating/replacing a line (no ids, no timestamps). */
export const lineInputSchema = lineSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type LineInput = z.infer<typeof lineInputSchema>;
