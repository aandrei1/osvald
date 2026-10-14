import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';
import { lineSchema } from './line.js';

export const sceneSchema = z.object({
  id: idSchema,
  scriptId: idSchema,
  /** 0-based position of the scene inside the script. */
  orderIndex: z.number().int().nonnegative(),
  /** Scene marker as printed, e.g. `1`, `2a`, `ACT I, SCENE 2`. */
  number: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  synopsis: z.string().nullable(),
  /** Inclusive page range in the source document, when known. */
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Scene = z.infer<typeof sceneSchema>;

/** A scene plus its ordered lines, as returned by `GET /scripts/:id`. */
export const sceneWithLinesSchema = sceneSchema.extend({
  lines: z.array(lineSchema),
});
export type SceneWithLines = z.infer<typeof sceneWithLinesSchema>;

export const sceneInputSchema = sceneSchema.omit({
  id: true,
  scriptId: true,
  createdAt: true,
  updatedAt: true,
});
export type SceneInput = z.infer<typeof sceneInputSchema>;
