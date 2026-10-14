import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common.js';

/** Public user representation. Never contains password material. */
export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  displayName: z.string().max(120).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

/* -------------------------------------------------------------------------- */
/* Route payloads                                                             */
/* -------------------------------------------------------------------------- */

export const registerBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  displayName: z.string().max(120).nullable().optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const meResponseSchema = z.object({
  user: userSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
