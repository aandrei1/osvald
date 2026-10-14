import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';
import {
  apiErrorSchema,
  characterListResponseSchema,
  idParamsSchema,
  noContentSchema,
  paginationQuerySchema,
  scriptDetailSchema,
  scriptListResponseSchema,
  uploadScriptResponseSchema,
} from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../config/env.js';
import { BadRequestError } from '../../lib/errors.js';
import { SCRIPT_PARSING_QUEUE } from '../../queue/jobs/script-parsing.js';
import {
  createUploadedScript,
  deleteScript,
  getScriptDetail,
  getScriptRow,
  listScripts,
  mapScriptRow,
} from '../../services/script.service.js';

/**
 * `/scripts` routes.
 *
 * Every route requires a bearer token: a script is personal rehearsal material.
 * Uploading streams the PDF to disk, inserts the row and enqueues a
 * `script-parsing` job — the parsing itself happens in the worker
 * (`src/queue/jobs/script-parsing.ts`), never on the request.
 */

interface StoredUpload {
  fileName: string;
  mimeType: string;
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

  return { fileName, mimeType: part.mimetype, storedPath };
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
        description: "The caller's library, newest first.",
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema,
        response: {
          200: scriptListResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      return listScripts(app.db, { limit, offset, userId: request.user.sub });
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

  app.post(
    '/upload',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Upload a script PDF',
        description:
          'Accepts a single multipart/form-data PDF plus optional `title`, `author` and `description` fields. Stores the file, inserts the script row and enqueues a `script-parsing` job.',
        consumes: ['multipart/form-data'],
        security: [{ bearerAuth: [] }],
        response: {
          201: uploadScriptResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          413: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const requestedByUserId = request.user.sub;

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

      const script = await createUploadedScript(app.db, {
        userId: requestedByUserId,
        title:
          requestedTitle !== undefined && requestedTitle.length > 0
            ? requestedTitle
            : titleFromFileName(upload.fileName),
        author: fields.get('author') ?? null,
        description: fields.get('description') ?? null,
        sourceFileName: upload.fileName,
        sourceFilePath: upload.storedPath,
      });

      // TODO(scripts): if enqueueing fails (Redis unreachable) the script stays
      // in `uploaded`. Move to a transactional outbox / retry sweep. Using the
      // script id as jobId keeps re-enqueueing idempotent.
      const job = await app.queues.scriptParsing.add(
        'parse-script',
        {
          scriptId: script.id,
          filePath: upload.storedPath,
          mimeType: upload.mimeType,
          requestedByUserId: script.userId,
        },
        { jobId: script.id },
      );

      return reply.status(201).send({
        script,
        jobId: job.id ?? script.id,
        queueName: SCRIPT_PARSING_QUEUE,
      });
    },
  );

  app.post(
    '/:id/reparse',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Run the parsing pipeline again',
        description:
          'Useful after a failed parse or a parser improvement. The previous scenes, characters and lines are replaced only once the new parse succeeds.',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          202: uploadScriptResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const script = await getScriptRow(app.db, request.params.id, request.user.sub);

      if (script.sourceFilePath === null) {
        throw new BadRequestError(
          'This script has no stored source file, so it cannot be re-parsed',
        );
      }

      // An earlier job with this id may still be retained in the queue; remove
      // it so the re-run is not rejected as a duplicate.
      await app.queues.scriptParsing.remove(script.id).catch(() => undefined);

      const job = await app.queues.scriptParsing.add(
        'parse-script',
        {
          scriptId: script.id,
          filePath: script.sourceFilePath,
          mimeType: 'application/pdf',
          requestedByUserId: script.userId,
        },
        { jobId: script.id },
      );

      return reply.status(202).send({
        script: { ...mapScriptRow(script), status: 'uploaded' },
        jobId: job.id ?? script.id,
        queueName: SCRIPT_PARSING_QUEUE,
      });
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['scripts'],
        summary: 'Delete a script and everything parsed from it',
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          204: noContentSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const script = await getScriptRow(app.db, request.params.id, request.user.sub);

      await deleteScript(app.db, script.id);

      if (script.sourceFilePath !== null) {
        // The row is already gone; a leftover file is not worth failing over.
        await rm(script.sourceFilePath, { force: true }).catch((error: unknown) => {
          request.log.warn({ err: error }, 'could not remove the stored upload');
        });
      }

      return reply.status(204).send(null);
    },
  );

  /*
   * TODO(scripts):
   *   POST   /scripts              create an empty script (manual entry)
   *   PATCH  /scripts/:id          title/author/description
   *   GET    /scripts/:id/progress  live parse progress from the BullMQ job
   */
};
