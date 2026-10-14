import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';

export const characterSchema = z.object({
  id: idSchema,
  scriptId: idSchema,
  /** Canonical display name, e.g. `Hamlet`. */
  name: z.string().min(1).max(200),
  /** Free-form casting/appearance notes. */
  description: z.string().nullable(),
  /** Alternate spellings found in the script, e.g. `HAMLET`, `Ham.`. */
  aliases: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Character = z.infer<typeof characterSchema>;

export const characterInputSchema = characterSchema.omit({
  id: true,
  scriptId: true,
  createdAt: true,
  updatedAt: true,
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

export const characterListResponseSchema = z.object({
  items: z.array(characterSchema),
});
export type CharacterListResponse = z.infer<typeof characterListResponseSchema>;
