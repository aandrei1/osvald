import { readdir, readFile, stat } from 'node:fs/promises';

import {
  apiErrorSchema,
  characterListResponseSchema,
  lossSummarySchema,
  scriptDetailSchema,
  scriptListResponseSchema,
  stageChangedResponseSchema,
} from '@osvald/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env.js';
import type { Database } from '../../src/db/client.js';
import { scripts } from '../../src/db/schema/scripts.js';
import {
  bearer,
  createTestApp,
  createTestUser,
  multipartFile,
  seedParsedScript,
} from '../helpers/app.js';
import { addMember, tryCreateTestDatabase } from '../helpers/database.js';

/**
 * Script routes are the upload → extract → review entry point. Uploads stream a
 * real PDF to disk and start the import through `ScriptProductionFlow`; the
 * worker itself is out of scope here, so the extraction queue is faked and the
 * handed-off job is asserted. The flow's own rules live in
 * `script-production-flow.test.ts`.
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
      const response = await test.app.inject({
        method: 'GET',
        url: '/scripts?workspaceId=00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).message).toBe('Missing or invalid bearer token');
    } finally {
      await test.close();
    }
  });

  it("lists one workspace's library", async () => {
    const test = await createTestApp(db());

    try {
      const mine = await createTestUser(test.app, db(), { email: 'mine@example.com' });
      const other = await createTestUser(test.app, db(), { email: 'other@example.com' });
      await seedParsedScript(db(), { workspaceId: mine.workspaceId, title: 'Mine' });
      await seedParsedScript(db(), { workspaceId: other.workspaceId, title: 'Theirs' });

      const response = await test.app.inject({
        method: 'GET',
        url: `/scripts?workspaceId=${mine.workspaceId}`,
        headers: bearer(mine.token),
      });
      expect(response.statusCode).toBe(200);

      const body = scriptListResponseSchema.parse(response.json());
      expect(body.items.map((script) => script.title)).toEqual(['Mine']);
      expect(body.items[0]?.workspaceId).toBe(mine.workspaceId);
      expect(body.total).toBe(1);
    } finally {
      await test.close();
    }
  });

  it('answers 404 for the library of a workspace the caller is not in', async () => {
    const test = await createTestApp(db());

    try {
      const mine = await createTestUser(test.app, db());
      const other = await createTestUser(test.app, db());

      const response = await test.app.inject({
        method: 'GET',
        url: `/scripts?workspaceId=${other.workspaceId}`,
        headers: bearer(mine.token),
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await test.close();
    }
  });

  it('lets a member read and nothing more', async () => {
    const test = await createTestApp(db());

    try {
      const editor = await createTestUser(test.app, db());
      const member = await createTestUser(test.app, db());
      await addMember(db(), editor.workspaceId, member.id);
      const seeded = await seedParsedScript(db(), { workspaceId: editor.workspaceId });

      const reads = [
        `/scripts?workspaceId=${editor.workspaceId}`,
        `/scripts/${seeded.scriptId}`,
        `/scripts/${seeded.scriptId}/characters`,
      ];
      for (const url of reads) {
        const response = await test.app.inject({
          method: 'GET',
          url,
          headers: bearer(member.token),
        });
        expect(response.statusCode, url).toBe(200);
      }

      const writes = [
        { method: 'POST', url: `/scripts/${seeded.scriptId}/reparse` },
        { method: 'GET', url: `/scripts/${seeded.scriptId}/reparse-preview` },
        { method: 'GET', url: `/scripts/${seeded.scriptId}/delete-preview` },
        { method: 'DELETE', url: `/scripts/${seeded.scriptId}` },
        {
          method: 'PATCH',
          url: `/scripts/${seeded.scriptId}/characters/${seeded.characterId}`,
          payload: { gender: 'female' },
        },
      ] as const;
      for (const write of writes) {
        const response = await test.app.inject({ ...write, headers: bearer(member.token) });
        expect(response.statusCode, `${write.method} ${write.url}`).toBe(403);
      }

      const [row] = await db().select().from(scripts).where(eq(scripts.id, seeded.scriptId));
      expect(row?.stage).toBe('in_review');
    } finally {
      await test.close();
    }
  });

  it("refuses a member's upload and keeps no file", async () => {
    const test = await createTestApp(db());

    try {
      const editor = await createTestUser(test.app, db());
      const member = await createTestUser(test.app, db());
      await addMember(db(), editor.workspaceId, member.id);
      const multipart = multipartFile(
        'avarul-excerpt.pdf',
        'application/pdf',
        await readFile(SAMPLE_PDF),
      );
      const filesBefore = await readdir(env.UPLOAD_DIR).catch(() => []);

      const response = await test.app.inject({
        method: 'POST',
        url: `/scripts/upload?workspaceId=${editor.workspaceId}`,
        headers: { ...multipart.headers, ...bearer(member.token) },
        payload: multipart.payload,
      });

      expect(response.statusCode).toBe(403);
      expect(test.extraction.jobs).toHaveLength(0);
      expect(await db().$count(scripts)).toBe(0);
      await expect(readdir(env.UPLOAD_DIR)).resolves.toEqual(filesBefore);
    } finally {
      await test.close();
    }
  });

  it('returns the full detail with ordered scenes, lines and cast', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { workspaceId: user.workspaceId });

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

  it('answers 404 for a script outside the caller workspaces', async () => {
    const test = await createTestApp(db());

    try {
      const owner = await createTestUser(test.app, db(), { email: 'owner@example.com' });
      const intruder = await createTestUser(test.app, db(), { email: 'intruder@example.com' });
      const seeded = await seedParsedScript(db(), { workspaceId: owner.workspaceId });

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
      const seeded = await seedParsedScript(db(), { workspaceId: user.workspaceId });

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

  it('previews what a delete or a reparse would remove', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { workspaceId: user.workspaceId });

      for (const preview of ['delete-preview', 'reparse-preview']) {
        const response = await test.app.inject({
          method: 'GET',
          url: `/scripts/${seeded.scriptId}/${preview}`,
          headers: bearer(user.token),
        });

        expect(response.statusCode).toBe(200);
        expect(lossSummarySchema.parse(response.json())).toEqual({
          sceneCount: 1,
          lineCount: 2,
          characterCount: 1,
          editedLineCount: 0,
          synthesizedCharacterCount: 0,
        });
      }
    } finally {
      await test.close();
    }
  });
  it('returns the cast of one script', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), { workspaceId: user.workspaceId });

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
        url: `/scripts/upload?workspaceId=${user.workspaceId}`,
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

  it('stores a PDF and starts the import in extracting', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const pdf = await readFile(SAMPLE_PDF);
      const multipart = multipartFile('avarul-excerpt.pdf', 'application/pdf', pdf);

      const response = await test.app.inject({
        method: 'POST',
        url: `/scripts/upload?workspaceId=${user.workspaceId}`,
        headers: { ...multipart.headers, ...bearer(user.token) },
        payload: multipart.payload,
      });

      expect(response.statusCode).toBe(201);

      const body = stageChangedResponseSchema.parse(response.json());
      expect(body.script.stage).toBe('extracting');
      expect(body.script.title).toBe('avarul excerpt');
      expect(body.script.sourceFileName).toBe('avarul-excerpt.pdf');
      expect(body.script.workspaceId).toBe(user.workspaceId);

      const [row] = await db().select().from(scripts).where(eq(scripts.id, body.script.id));
      expect(test.extraction.jobs).toEqual([
        { scriptId: body.script.id, runId: row?.runId, filePath: row?.sourceFilePath },
      ]);

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

  it('reparses a stored script under a new run', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const pdf = await readFile(SAMPLE_PDF);
      const multipart = multipartFile('avarul-excerpt.pdf', 'application/pdf', pdf);

      const uploaded = await test.app.inject({
        method: 'POST',
        url: `/scripts/upload?workspaceId=${user.workspaceId}`,
        headers: { ...multipart.headers, ...bearer(user.token) },
        payload: multipart.payload,
      });
      const { script } = stageChangedResponseSchema.parse(uploaded.json());
      const firstRun = test.extraction.jobs[0]?.runId;

      const response = await test.app.inject({
        method: 'POST',
        url: `/scripts/${script.id}/reparse`,
        headers: bearer(user.token),
      });

      expect(response.statusCode).toBe(202);

      const body = stageChangedResponseSchema.parse(response.json());
      expect(body.script.stage).toBe('extracting');

      expect(test.extraction.jobs).toHaveLength(2);
      const secondRun = test.extraction.jobs[1];
      expect(secondRun?.scriptId).toBe(script.id);
      expect(secondRun?.runId).not.toBe(firstRun);
    } finally {
      await test.close();
    }
  });

  it('refuses to reparse a script without a stored PDF', async () => {
    const test = await createTestApp(db());

    try {
      const user = await createTestUser(test.app, db());
      const seeded = await seedParsedScript(db(), {
        workspaceId: user.workspaceId,
        sourceFilePath: null,
      });

      const response = await test.app.inject({
        method: 'POST',
        url: `/scripts/${seeded.scriptId}/reparse`,
        headers: bearer(user.token),
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(response.json()).message).toMatch(/no stored source file/);
      expect(test.extraction.jobs).toHaveLength(0);
    } finally {
      await test.close();
    }
  });
});
