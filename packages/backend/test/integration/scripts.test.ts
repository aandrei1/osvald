import { readFile, stat } from 'node:fs/promises';

import {
  apiErrorSchema,
  characterListResponseSchema,
  scriptDetailSchema,
  scriptListResponseSchema,
  uploadScriptResponseSchema,
} from '@osvald/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { scripts } from '../../src/db/schema/scripts.js';
import {
  bearer,
  createTestApp,
  createTestUser,
  multipartFile,
  seedParsedScript,
} from '../helpers/app.js';
import { tryCreateTestDatabase } from '../helpers/database.js';

/**
 * Script routes are the upload → parse → rehearse entry point. Uploads stream a
 * real PDF to disk and enqueue a BullMQ job; the worker itself is out of scope
 * here, so the queue registry is faked and the enqueue is asserted.
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

const SAMPLE_PDF = new URL('../../../../samples/avarul-excerpt.pdf', import.meta.url);

describe.skipIf(database === null)('scripts routes', () => {
  it('requires a bearer token', async () => {
    const test = await createTestApp(db());

    try {
      const response = await test.app.inject({ method: 'GET', url: '/scripts' });

      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).message).toBe('Missing or invalid bearer token');
    } finally {
      await test.close();
    }
  });

  it('lists the caller library plus anonymous scripts', async () => {
    const test = await createTestApp(db());

    try {
      const mine = await createTestUser(test.app, db(), { email: 'mine@example.com' });
      const other = await createTestUser(test.app, db(), { email: 'other@example.com' });
      await seedParsedScript(db(), { userId: mine.id, title: 'Mine' });
      await seedParsedScript(db(), { userId: other.id, title: 'Theirs' });
      await seedParsedScript(db(), { userId: null, title: 'Anonymous' });

      const response = await test.app.inject({
        method: 'GET',
        url: '/scripts',
        headers: bearer(mine.token),
      });
      expect(response.statusCode).toBe(200);

      const body = scriptListResponseSchema.parse(response.json());
      expect(body.items.map((script) => script.title).sort()).toEqual(['Anonymous', 'Mine']);
      expect(body.total).toBe(2);
    } finally {
      await test.close();
    }
  });

  it('returns the full detail with ordered scenes, lines and cast', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { userId: user.id });

      const response = await test.app.inject({
        method: 'GET',
        url: `/scripts/${seeded.scriptId}`,
        headers: bearer(user.token),
      });
      expect(response.statusCode).toBe(200);

      const body = scriptDetailSchema.parse(response.json());
      expect(body.scenes).toHaveLength(1);
      expect(body.scenes[0]?.lines.map((line) => line.type)).toEqual(['dialogue', 'direction']);
      expect(body.characters.map((character) => character.name)).toEqual(['Harpagon']);
    } finally {
      await test.close();
    }
  });

  it('answers 404 for another account script', async () => {
    const test = await createTestApp(db());

    try {
      const owner = await createTestUser(test.app, db(), { email: 'owner@example.com' });
      const intruder = await createTestUser(test.app, db(), { email: 'intruder@example.com' });
      const seeded = await seedParsedScript(db(), { userId: owner.id });

      const response = await test.app.inject({
        method: 'GET',
        url: `/scripts/${seeded.scriptId}`,
        headers: bearer(intruder.token),
      });

      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).message).toContain('was not found');
    } finally {
      await test.close();
    }
  });

  it('deletes a script and everything parsed from it', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { userId: user.id });

      const deleted = await test.app.inject({
        method: 'DELETE',
        url: `/scripts/${seeded.scriptId}`,
        headers: bearer(user.token),
      });
      expect(deleted.statusCode).toBe(204);

      const after = await test.app.inject({
        method: 'GET',
        url: `/scripts/${seeded.scriptId}`,
        headers: bearer(user.token),
      });
      expect(after.statusCode).toBe(404);

      const remaining = await db().select().from(scripts).where(eq(scripts.id, seeded.scriptId));
      expect(remaining).toHaveLength(0);
    } finally {
      await test.close();
    }
  });
  it('returns the cast of one script', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { userId: user.id });

      const response = await test.app.inject({
        method: 'GET',
        url: `/scripts/${seeded.scriptId}/characters`,
        headers: bearer(user.token),
      });
      expect(response.statusCode).toBe(200);

      const body = characterListResponseSchema.parse(response.json());
      expect(body.items.map((character) => character.name)).toEqual(['Harpagon']);
      expect(body.items[0]?.aliases).toEqual(['HARPAGON']);
    } finally {
      await test.close();
    }
  });

  it('rejects a malformed id before the handler runs', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const response = await test.app.inject({
        method: 'GET',
        url: '/scripts/not-a-uuid',
        headers: bearer(user.token),
      });

      expect(response.statusCode).toBe(400);

      const body = apiErrorSchema.parse(response.json());
      expect(body.details?.some((detail) => detail.path === '/id')).toBe(true);
    } finally {
      await test.close();
    }
  });

  it('rejects a non-PDF upload with 400', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const multipart = multipartFile('notes.txt', 'text/plain', Buffer.from('not a pdf'));

      const response = await test.app.inject({
        method: 'POST',
        url: '/scripts/upload',
        headers: { ...multipart.headers, ...bearer(user.token) },
        payload: multipart.payload,
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(response.json()).message).toContain(
        'Only PDF files are supported',
      );
      expect(test.queues.add).not.toHaveBeenCalled();
    } finally {
      await test.close();
    }
  });

  it('stores a PDF, inserts the row and enqueues the parse job', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const pdf = await readFile(SAMPLE_PDF);
      const multipart = multipartFile('avarul-excerpt.pdf', 'application/pdf', pdf);

      const response = await test.app.inject({
        method: 'POST',
        url: '/scripts/upload',
        headers: { ...multipart.headers, ...bearer(user.token) },
        payload: multipart.payload,
      });

      expect(response.statusCode).toBe(201);

      const body = uploadScriptResponseSchema.parse(response.json());
      expect(body.script.status).toBe('uploaded');
      expect(body.script.title).toBe('avarul excerpt');
      expect(body.script.sourceFileName).toBe('avarul-excerpt.pdf');
      expect(body.queueName).toBe('script-parsing');
      expect(body.jobId).toBe(body.script.id);

      expect(test.queues.add).toHaveBeenCalledTimes(1);
      expect(test.queues.add).toHaveBeenCalledWith(
        'parse-script',
        expect.objectContaining({
          scriptId: body.script.id,
          mimeType: 'application/pdf',
          requestedByUserId: user.id,
        }),
        { jobId: body.script.id },
      );

      const [row] = await db().select().from(scripts).where(eq(scripts.id, body.script.id));
      const storedPath = row?.sourceFilePath;
      expect(storedPath).toBeTruthy();
      if (storedPath === null || storedPath === undefined) {
        throw new Error('upload did not record a stored path');
      }
      // The whole file was streamed, not just its first chunk.
      await expect(stat(storedPath)).resolves.toMatchObject({ size: pdf.byteLength });
    } finally {
      await test.close();
    }
  });

  it('re-enqueues a stored script for parsing', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const pdf = await readFile(SAMPLE_PDF);
      const multipart = multipartFile('avarul-excerpt.pdf', 'application/pdf', pdf);

      const uploaded = await test.app.inject({
        method: 'POST',
        url: '/scripts/upload',
        headers: { ...multipart.headers, ...bearer(user.token) },
        payload: multipart.payload,
      });
      const { script } = uploadScriptResponseSchema.parse(uploaded.json());

      test.queues.add.mockClear();
      test.queues.remove.mockClear();

      const response = await test.app.inject({
        method: 'POST',
        url: `/scripts/${script.id}/reparse`,
        headers: bearer(user.token),
      });

      expect(response.statusCode).toBe(202);

      const body = uploadScriptResponseSchema.parse(response.json());
      expect(body.script.status).toBe('uploaded');
      expect(test.queues.remove).toHaveBeenCalledWith(script.id);
      expect(test.queues.add).toHaveBeenCalledTimes(1);
      expect(test.queues.add).toHaveBeenCalledWith(
        'parse-script',
        expect.objectContaining({ scriptId: script.id }),
        { jobId: script.id },
      );
    } finally {
      await test.close();
    }
  });
});
