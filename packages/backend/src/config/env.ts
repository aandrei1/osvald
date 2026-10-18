import 'dotenv/config';

import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Loaded once at startup: `.env` is read by dotenv, then every value is
 * validated by Zod. An invalid/missing value aborts the process with a readable
 * report instead of failing later at runtime.
 */

const booleanFromString = (defaultValue: 'true' | 'false' = 'true') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Postgres / Drizzle
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis / BullMQ
  REDIS_URL: z.url(),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().min(1).default('1h'),

  // HTTP
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  // PDF uploads
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  // Python OCR service
  OCR_SERVICE_URL: z.url().default('http://localhost:8001'),
  OCR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Whole-document extraction: minutes, not seconds, when pages need OCR. */
  OCR_PDF_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  /** Language pack the OCR service is configured with. */
  OCR_LANGUAGE: z.string().min(2).default('ro'),

  // Python TTS service
  TTS_SERVICE_URL: z.url().default('http://localhost:8002'),
  TTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /**
   * One line of CPU synthesis is under a second warm, but the first call to a
   * voice also loads (or downloads) its model.
   */
  TTS_SYNTHESIS_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // Queue worker
  SCRIPT_PARSING_WORKER_ENABLED: booleanFromString(),
  SCRIPT_PARSING_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Reported by GET /health
  APP_VERSION: z.string().min(1).default('0.1.0'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      [
        'Invalid environment configuration.',
        'Copy packages/backend/.env.example to packages/backend/.env and fix the values below:',
        '',
        z.prettifyError(parsed.error),
      ].join('\n'),
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';

/** `CORS_ORIGIN` is a comma-separated list so Capacitor + web can coexist. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
