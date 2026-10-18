import { apiErrorSchema, authResponseSchema, meResponseSchema } from '@osvald/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { bearer, createTestApp } from '../helpers/app.js';
import { tryCreateTestDatabase } from '../helpers/database.js';

/**
 * Accounts are real: Argon2id hashes, JWTs signed with `JWT_SECRET`, and the
 * unique index on `users.email` as the only authority on duplicates.
 */

const database = await tryCreateTestDatabase();

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database?.truncate();
});

function db(): Database {
  if (database === null) {
    throw new Error('test database unavailable');
  }
  return database.db;
}

const REGISTER = {
  email: 'actor@example.com',
  password: 'correct horse',
  displayName: 'Actor',
};

describe.skipIf(database === null)('auth routes', () => {
  it('registers an account, normalises the e-mail and returns a token', async () => {
    const test = await createTestApp(db());

    try {
      const response = await test.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...REGISTER, email: 'Actor@Example.COM' },
      });

      expect(response.statusCode).toBe(201);

      const body = authResponseSchema.parse(response.json());
      expect(body.user.email).toBe('actor@example.com');
      expect(body.user.displayName).toBe('Actor');
      expect(body.accessToken.length).toBeGreaterThan(0);
      expect(body.expiresIn).toBe(3600);
      // The public representation must never carry password material.
      expect(body.user).not.toHaveProperty('passwordHash');
    } finally {
      await test.close();
    }
  });

  it('rejects a duplicate e-mail with 409', async () => {
    const test = await createTestApp(db());

    try {
      await test.app.inject({ method: 'POST', url: '/auth/register', payload: REGISTER });
      const response = await test.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...REGISTER, email: 'ACTOR@example.com' },
      });

      expect(response.statusCode).toBe(409);

      const body = apiErrorSchema.parse(response.json());
      expect(body.message).toContain('already exists');
    } finally {
      await test.close();
    }
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    const test = await createTestApp(db());

    try {
      await test.app.inject({ method: 'POST', url: '/auth/register', payload: REGISTER });

      const good = await test.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: REGISTER.email, password: REGISTER.password },
      });
      expect(good.statusCode).toBe(200);
      expect(authResponseSchema.parse(good.json()).accessToken.length).toBeGreaterThan(0);

      const bad = await test.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: REGISTER.email, password: 'definitely wrong' },
      });
      expect(bad.statusCode).toBe(401);
      expect(apiErrorSchema.parse(bad.json()).message).toBe('Incorrect e-mail address or password');
    } finally {
      await test.close();
    }
  });

  it('returns the current user for a valid token and 401 otherwise', async () => {
    const test = await createTestApp(db());

    try {
      const registered = await test.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: REGISTER,
      });
      const { accessToken } = authResponseSchema.parse(registered.json());

      const me = await test.app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer(accessToken),
      });
      expect(me.statusCode).toBe(200);
      expect(meResponseSchema.parse(me.json()).user.email).toBe(REGISTER.email);

      const anonymous = await test.app.inject({ method: 'GET', url: '/auth/me' });
      expect(anonymous.statusCode).toBe(401);

      const garbage = await test.app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: bearer('not-a-jwt'),
      });
      expect(garbage.statusCode).toBe(401);
      expect(apiErrorSchema.parse(garbage.json()).message).toBe('Missing or invalid bearer token');
    } finally {
      await test.close();
    }
  });

  it('answers 400 with field details for an invalid body', async () => {
    const test = await createTestApp(db());

    try {
      const response = await test.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'short' },
      });

      expect(response.statusCode).toBe(400);

      const body = apiErrorSchema.parse(response.json());
      expect(body.message).toBe('Request validation failed');
      expect(body.details?.length).toBeGreaterThanOrEqual(2);
    } finally {
      await test.close();
    }
  });
});
