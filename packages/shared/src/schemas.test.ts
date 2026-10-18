import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  noContentSchema,
  paginationQuerySchema,
  scriptSchema,
  scriptStatusSchema,
  synthesizeSpeechBodySchema,
  registerBodySchema,
} from './index.js';

/**
 * The shared schemas are the single source of truth for the HTTP boundary: the
 * backend validates requests/responses with them and the frontend parses every
 * response with the same objects. These tests pin the contract itself.
 */

const validScript = {
  id: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b',
  userId: null,
  title: 'Avarul',
  author: 'Molière',
  description: null,
  status: 'parsed',
  sourceFileName: 'avarul.pdf',
  pageCount: 286,
  parseError: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:00:00.000Z',
} as const;

describe('scriptSchema', () => {
  it('accepts a complete script payload', () => {
    expect(scriptSchema.parse(validScript)).toEqual(validScript);
  });

  it('rejects a non-UUID id', () => {
    expect(scriptSchema.safeParse({ ...validScript, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a timestamp that is not ISO-8601 UTC', () => {
    expect(
      scriptSchema.safeParse({ ...validScript, createdAt: '2026-10-18 12:00:00' }).success,
    ).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(scriptSchema.safeParse({ ...validScript, status: 'done' }).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(scriptSchema.safeParse({ ...validScript, title: '' }).success).toBe(false);
  });

  it('lists exactly the states the upload → parse flow uses', () => {
    expect(scriptStatusSchema.options).toEqual(['uploaded', 'parsing', 'parsed', 'failed']);
  });
});

describe('paginationQuerySchema', () => {
  it('applies the documented defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces query-string values to numbers', () => {
    expect(paginationQuerySchema.parse({ limit: '10', offset: '5' })).toEqual({
      limit: 10,
      offset: 5,
    });
  });

  it('bounds the page size', () => {
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects a negative offset', () => {
    expect(paginationQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});

describe('registerBodySchema', () => {
  it('accepts a valid registration', () => {
    expect(
      registerBodySchema.safeParse({ email: 'actor@example.com', password: 'longenough' }).success,
    ).toBe(true);
  });

  it('rejects a malformed e-mail', () => {
    expect(registerBodySchema.safeParse({ email: 'actor', password: 'longenough' }).success).toBe(
      false,
    );
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      registerBodySchema.safeParse({ email: 'actor@example.com', password: 'short' }).success,
    ).toBe(false);
  });
});

describe('synthesizeSpeechBodySchema', () => {
  it('accepts a line of dialogue', () => {
    expect(
      synthesizeSpeechBodySchema.safeParse({ text: 'Bună ziua.', voiceId: 'piper:amy' }).success,
    ).toBe(true);
  });

  it('rejects empty text and a missing voice', () => {
    expect(synthesizeSpeechBodySchema.safeParse({ text: '', voiceId: 'piper:amy' }).success).toBe(
      false,
    );
    expect(synthesizeSpeechBodySchema.safeParse({ text: 'Bună.', voiceId: '' }).success).toBe(
      false,
    );
  });

  it('caps a single synthesis request at 2000 characters', () => {
    expect(
      synthesizeSpeechBodySchema.safeParse({ text: 'a'.repeat(2_001), voiceId: 'piper:amy' })
        .success,
    ).toBe(false);
  });
});

describe('apiErrorSchema and noContentSchema', () => {
  it('accepts the standard error body used by the Fastify handler', () => {
    expect(
      apiErrorSchema.parse({
        statusCode: 404,
        error: 'Not Found',
        message: 'Script "x" was not found',
      }),
    ).toBeTruthy();
  });

  it('accepts optional field details', () => {
    expect(
      apiErrorSchema.safeParse({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request validation failed',
        details: [{ path: '/title', message: 'Too small' }],
      }).success,
    ).toBe(true);
  });

  it('represents a 204 response as null', () => {
    expect(noContentSchema.parse(null)).toBeNull();
    expect(noContentSchema.safeParse(undefined).success).toBe(false);
  });
});
