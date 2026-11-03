import { z } from 'zod';

import { genderSchema, idSchema, isoDateTimeSchema } from './common.js';

/** `auto` is re-detected on every parse; `manual` survives a reparse. */
export const GENDER_SOURCES = ['auto', 'manual'] as const;
export const genderSourceSchema = z.enum(GENDER_SOURCES);
export type GenderSource = z.infer<typeof genderSourceSchema>;

export const characterSchema = z.object({
  id: idSchema,
  scriptId: idSchema,
  /** Canonical display name, e.g. `Hamlet`. */
  name: z.string().min(1).max(200),
  /** Free-form casting/appearance notes. */
  description: z.string().nullable(),
  /** Alternate spellings found in the script, e.g. `HAMLET`, `Ham.`. */
  aliases: z.array(z.string()),
  /** Drives which voices the role is cast with. */
  gender: genderSchema,
  genderSource: genderSourceSchema,
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

/** Body of `PATCH /scripts/:id/characters/:characterId`; marks the gender `manual`. */
export const updateCharacterBodySchema = z.object({
  gender: genderSchema,
});
export type UpdateCharacterBody = z.infer<typeof updateCharacterBodySchema>;

export const characterParamsSchema = z.object({
  id: idSchema,
  characterId: idSchema,
});
export type CharacterParams = z.infer<typeof characterParamsSchema>;

export const characterListResponseSchema = z.object({
  items: z.array(characterSchema),
});
export type CharacterListResponse = z.infer<typeof characterListResponseSchema>;
