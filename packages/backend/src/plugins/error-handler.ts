import type { ApiError } from '@osvald/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

import { isProduction } from '../config/env.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  NotImplementedError,
  UnauthorizedError,
} from '../lib/errors.js';

/**
 * One place that turns thrown errors into the `ApiError` shape from
 * `@osvald/shared`, so clients always get `{ statusCode, error, message }`.
 */

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Service Unavailable',
};

function statusText(statusCode: number): string {
  return STATUS_TEXT[statusCode] ?? 'Error';
}

function toStatusAndMessage(error: unknown): { statusCode: number; message: string } {
  if (error instanceof NotImplementedError) {
    return { statusCode: 501, message: error.message };
  }
  if (error instanceof BadRequestError) {
    return { statusCode: 400, message: error.message };
  }
  if (error instanceof UnauthorizedError) {
    return { statusCode: 401, message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { statusCode: 404, message: error.message };
  }
  if (error instanceof ConflictError) {
    return { statusCode: 409, message: error.message };
  }

  const fastifyError = error as FastifyError;
  const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  const message = fastifyError.message ?? 'Unexpected error';

  return { statusCode, message };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Zod request validation failures (validatorCompiler) → 400 + field details.
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ err: error }, 'request validation failed');

      return reply.status(400).send({
        statusCode: 400,
        error: statusText(400),
        message: 'Request validation failed',
        // fastify-type-provider-zod builds `instancePath` from the Zod issue
        // path, e.g. `/title` or `/query/limit`.
        details: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message ?? 'Invalid value',
        })),
      } satisfies ApiError);
    }

    // A handler returned data that does not match its response schema.
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response serialization failed');

      return reply.status(500).send({
        statusCode: 500,
        error: statusText(500),
        message: 'Response does not match the declared schema',
      } satisfies ApiError);
    }

    const { statusCode, message } = toStatusAndMessage(error);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ err: error, statusCode }, 'request rejected');
    }

    return reply.status(statusCode).send({
      statusCode,
      error: statusText(statusCode),
      // Never leak internals of a 5xx to clients.
      message: isProduction && statusCode >= 500 ? statusText(statusCode) : message,
    } satisfies ApiError);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      statusCode: 404,
      error: statusText(404),
      message: `Route ${request.method} ${request.url} not found`,
    } satisfies ApiError),
  );
}
