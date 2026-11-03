import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';
import {
  apiErrorSchema,
  characterListResponseSchema,
  characterParamsSchema,
  characterSchema,
  idParamsSchema,
  lossSummarySchema,
  noContentSchema,
  scriptDetailSchema,
  scriptListQuerySchema,
  scriptListResponseSchema,
  stageChangedResponseSchema,
  updateCharacterBodySchema,
  workspaceIdQuerySchema,
} from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../config/env.js';
import { BadRequestError } from '../../lib/errors.js';
import { getScriptDetail, listScripts } from '../../services/script.service.js';

/**
 * `/scripts` routes.
 *
 * Every route requires a bearer token. A script belongs to a workspace: its
 * members read it, its editor prepares it, and the role is checked on the
 * server by every command (403 for a member, 404 outside the workspace).
 * The routes are thin: they validate the request and call one command of
 * `ScriptProductionFlow` (`app.scriptFlow`), which answers with the new stage.
 * Uploading streams the PDF to disk first; extraction happens on the worker,
 * never on the request.
 */

interface StoredUpload {
  fileName: string;
  storedPath: string;
}

function titleFromFileName(fileName: string): string {
  const withoutExtension = basename(fileName, extname(fileName)).replace(/[-_]+/g, ' ').trim();
  return withoutExtension.length > 0 ? withoutExtension : 'Untitled script';
}

/**
 * Streams one multipart file part to `UPLOAD_DIR`.
 *
 * TODO(scripts): sniff the `%PDF-` magic bytes, scan for malware, and store in
 * object storage (S3/R2) instead of the local disk. Oversized uploads are
 * rejected by @fastify/multipart (`UPLOAD_MAX_BYTES`) with a 413.
 */
async function storeUpload(part: MultipartFile): Promise<StoredUpload> {
  const fileName = part.filename.length > 0 ? part.filename : 'script.pdf';
  const looksLikePdf =
    part.mimetype === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  if (!looksLikePdf) {
    part.file.resume();
    throw new BadRequestError(
      `Only PDF files are supported (field "${part.fieldname}", type "${part.mimetype}")`,
    );
  }

  const uploadDir = resolve(env.UPLOAD_DIR);
  await mkdir(uploadDir, { recursive: true });

  const storedPath = join(uploadDir, `${randomUUID()}.pdf`);

  try {
    await pipeline(part.file, createWriteStream(storedPath));
  } catch (error) {
    await rm(storedPath, { force: true });
    throw error;
  }

  return { fileName, storedPath };
}

export const scriptRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  // Every route below needs an identified caller, so the guard is registered
  // once for the whole prefix instead of per route.
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['scripts'],
        summary: 'List scripts',
        description: "One workspace's library, newest first. Any member may read it.",
        security: [{ bearerAuth: [] }],
        querystring: scriptListQuerySchema,
        response: {
          200: scriptListResponseSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset, workspaceId } = request.query;
      return listScripts(app.db, { limit, offset, workspaceId, userId: request.user.sub });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Get one script with its scenes, lines and characters',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: scriptDetailSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => getScriptDetail(app.db, request.params.id, request.user.sub),
  );

  app.get(
    '/:id/characters',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Cast of one script',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: characterListResponseSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const script = await getScriptDetail(app.db, request.params.id, request.user.sub);
      return { items: script.characters };
    },
  );

  app.patch(
    '/:id/characters/:characterId',
    {
      schema: {
        tags: ['scripts'],
        summary: "Correct a character's gender",
        description:
          'Editor only. Overrides the detected gender. The value is kept when the script is parsed again.',
        security: [{ bearerAuth: [] }],
        params: characterParamsSchema,
        body: updateCharacterBodySchema,
        response: {
          200: characterSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { character } = await app.scriptFlow.confirmGender(
        { userId: request.user.sub },
        request.params.id,
        request.params.characterId,
        request.body.gender,
      );
      return character;
    },
  );

  app.post(
    '/upload',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Upload a script PDF',
        description:
          'Editor only. Accepts a single multipart/form-data PDF plus optional `title`, `author` and `description` fields, into the workspace named by `workspaceId`. Stores the file and starts the import: the script answers in `extracting` while the worker reads it.',
        consumes: ['multipart/form-data'],
        security: [{ bearerAuth: [] }],
        querystring: workspaceIdQuerySchema,
        response: {
          201: stageChangedResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          413: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const fields = new Map<string, string>();
      let upload: StoredUpload | undefined;

      for await (const part of request.parts()) {
        if (part.type === 'field') {
          const value = part.value;
          fields.set(
            part.fieldname,
            typeof value === 'string'
              ? value
              : Buffer.isBuffer(value)
                ? value.toString('utf8')
                : String(value),
          );
          continue;
        }

        if (upload !== undefined) {
          part.file.resume();
          throw new BadRequestError('Upload exactly one file per request');
        }

        upload = await storeUpload(part);
      }

      if (upload === undefined) {
        throw new BadRequestError('A PDF file is required in the "file" field');
      }

      const requestedTitle = fields.get('title')?.trim();

      try {
        const { script } = await app.scriptFlow.startImport(
          { userId: request.user.sub },
          request.query.workspaceId,
          {
            fileName: upload.fileName,
            storedPath: upload.storedPath,
            title:
              requestedTitle !== undefined && requestedTitle.length > 0
                ? requestedTitle
                : titleFromFileName(upload.fileName),
            author: fields.get('author') ?? null,
            description: fields.get('description') ?? null,
          },
        );

        return await reply.status(201).send({ script });
      } catch (error) {
        // A refused import (a member, a foreign workspace) leaves no file behind.
        await rm(upload.storedPath, { force: true });
        throw error;
      }
    },
  );

  app.get(
    '/:id/reparse-preview',
    {
      schema: {
        tags: ['scripts'],
        summary: 'What a reparse would replace',
        description: 'Shown to the editor before they confirm a reparse.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: lossSummarySchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) =>
      app.scriptFlow.previewReparse({ userId: request.user.sub }, request.params.id),
  );

  app.post(
    '/:id/reparse',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Extract the stored PDF again',
        description:
          'Editor only. Allowed in every stage, under a new run. The current scenes, characters and lines are replaced once the new extraction completes; text corrected by hand is lost, manual genders are kept.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          202: stageChangedResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { script } = await app.scriptFlow.reparse(
        { userId: request.user.sub },
        request.params.id,
      );
      return reply.status(202).send({ script });
    },
  );

  app.get(
    '/:id/delete-preview',
    {
      schema: {
        tags: ['scripts'],
        summary: 'What deleting the script would remove',
        description: 'Shown to the editor before they confirm a delete.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: lossSummarySchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) =>
      app.scriptFlow.previewDelete({ userId: request.user.sub }, request.params.id),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Delete a script and everything parsed from it',
        description: 'Editor only.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          204: noContentSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await app.scriptFlow.delete({ userId: request.user.sub }, request.params.id);
      return reply.status(204).send(null);
    },
  );

  /*
   * TODO(scripts):
   *   POST   /scripts              create an empty script (manual entry)
   *   PATCH  /scripts/:id          title/author/description
   *   GET    /scripts/:id/progress  live extraction progress from the BullMQ job
   */
};
