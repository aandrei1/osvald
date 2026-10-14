import { pathToFileURL } from 'node:url';

import { Worker, type Job } from 'bullmq';

import { env } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { createConsoleLogger, type Logger } from '../lib/logger.js';
import { createOcrClient } from '../services/ocr.client.js';
import { redisConnectionOptions } from './connection.js';
import {
  SCRIPT_PARSING_QUEUE,
  processScriptParsingJob,
  type ScriptParsingJobData,
  type ScriptParsingJobResult,
} from './jobs/script-parsing.js';

/**
 * Standalone BullMQ worker process for the `script-parsing` queue.
 *
 * Run it with `pnpm --filter @osvald/backend dev:worker` (hot reload), or in
 * Docker via `docker compose --profile worker up -d`.
 *
 * TODO(scaling): one process per queue + `WORKER_CONCURRENCY`, and move the
 * processor into a sandboxed file (`processorFile`) if parsing turns CPU-bound.
 */

export interface ScriptParsingWorkerHandle {
  worker: Worker<ScriptParsingJobData, ScriptParsingJobResult>;
  close(): Promise<void>;
}

export function createScriptParsingWorker(logger: Logger): ScriptParsingWorkerHandle {
  const database = createDatabase();
  const ocr = createOcrClient();

  const worker = new Worker<ScriptParsingJobData, ScriptParsingJobResult>(
    SCRIPT_PARSING_QUEUE,
    (job: Job<ScriptParsingJobData, ScriptParsingJobResult>) =>
      processScriptParsingJob(job, { db: database.db, logger, ocr }),
    {
      connection: redisConnectionOptions(),
      concurrency: env.SCRIPT_PARSING_CONCURRENCY,
    },
  );

  worker.on('active', (job) => {
    logger.info(`job ${job.id} started`, SCRIPT_PARSING_QUEUE);
  });

  worker.on('completed', (job) => {
    logger.info(`job ${job.id} completed`, SCRIPT_PARSING_QUEUE);
  });

  worker.on('failed', (job, error) => {
    logger.error(`job ${job?.id ?? 'unknown'} failed`, error.message);
  });

  worker.on('error', (error) => {
    // Connection problems land here; BullMQ keeps retrying in the background.
    logger.warn('worker error', error.message);
  });

  return {
    worker,
    async close(): Promise<void> {
      await worker.close();
      await database.close();
    },
  };
}

async function main(): Promise<void> {
  const logger = createConsoleLogger(env.LOG_LEVEL);

  if (!env.SCRIPT_PARSING_WORKER_ENABLED) {
    logger.warn('SCRIPT_PARSING_WORKER_ENABLED=false — worker will not start');
    return;
  }

  const handle = createScriptParsingWorker(logger);

  await handle.worker.waitUntilReady();
  logger.info(
    `${SCRIPT_PARSING_QUEUE} worker ready (concurrency=${env.SCRIPT_PARSING_CONCURRENCY})`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`received ${signal}, shutting down`);
    await handle.close();
    process.exit(0);
  };

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

/** Only start when this module is the process entry point (not when imported). */
const entryPoint = process.argv[1];
const isEntryPoint = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isEntryPoint) {
  await main();
}
