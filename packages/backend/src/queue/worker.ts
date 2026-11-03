import { pathToFileURL } from 'node:url';

import { Queue, Worker, type Job } from 'bullmq';

import { createBullmqExtractionQueue } from '../adapters/bullmq-extraction-queue.js';
import { createLocalSourceFileStore } from '../adapters/local-source-file-store.js';
import { env } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { ScriptProductionFlow, type RecoveryReport } from '../flows/script-production-flow.js';
import { createConsoleLogger, type Logger } from '../lib/logger.js';
import { RuleBasedGenderClassifier } from '../parsing/gender/gender-classifier.js';
import { systemClock } from '../ports/clock.js';
import { createOcrClient } from '../services/ocr.client.js';
import { redisConnectionOptions } from './connection.js';
import {
  SCRIPT_PARSING_QUEUE,
  processScriptParsingJob,
  type ScriptParsingJobData,
  type ScriptParsingJobResult,
} from './jobs/script-parsing.js';
import {
  SCRIPT_RECOVERY_QUEUE,
  SCRIPT_RECOVERY_SCHEDULER_ID,
  processScriptRecoveryJob,
} from './jobs/script-recovery.js';
import { createQueueRegistry } from './queues.js';

/**
 * Standalone BullMQ worker process for the `script-parsing` queue, plus the
 * periodic `script-recovery` job that re-queues runs lost on the way.
 *
 * Run it with `pnpm --filter @osvald/backend dev:worker` (hot reload), or in
 * Docker via `docker compose --profile worker up -d`.
 *
 * TODO(scaling): one process per queue + `WORKER_CONCURRENCY`, and move the
 * processor into a sandboxed file (`processorFile`) if parsing turns CPU-bound.
 */

export interface ScriptParsingWorkerHandle {
  worker: Worker<ScriptParsingJobData, ScriptParsingJobResult>;
  recoveryWorker: Worker<void, RecoveryReport>;
  close(): Promise<void>;
}

export function createScriptParsingWorker(logger: Logger): ScriptParsingWorkerHandle {
  const database = createDatabase();
  const ocr = createOcrClient();
  const genders = new RuleBasedGenderClassifier();
  // The worker is also a producer: recovery puts lost runs back on the queue.
  const queues = createQueueRegistry(logger);

  const flow = new ScriptProductionFlow({
    db: database.db,
    extractionQueue: createBullmqExtractionQueue(queues.scriptParsing),
    sourceFiles: createLocalSourceFileStore(logger),
    clock: systemClock,
    logger,
  });

  const worker = new Worker<ScriptParsingJobData, ScriptParsingJobResult>(
    SCRIPT_PARSING_QUEUE,
    (job: Job<ScriptParsingJobData, ScriptParsingJobResult>) =>
      processScriptParsingJob(job, { flow, logger, ocr, genders }),
    {
      connection: redisConnectionOptions(),
      concurrency: env.SCRIPT_PARSING_CONCURRENCY,
    },
  );

  const recoveryQueue = new Queue<void, RecoveryReport>(SCRIPT_RECOVERY_QUEUE, {
    connection: redisConnectionOptions(),
    defaultJobOptions: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
  });
  recoveryQueue.on('error', (error: Error) => {
    logger.warn('script-recovery queue error', error.message);
  });

  // Upserting keeps one scheduler however many workers start, and picks up a
  // changed interval on the next boot.
  void recoveryQueue
    .upsertJobScheduler(SCRIPT_RECOVERY_SCHEDULER_ID, { every: env.SCRIPT_RECOVERY_INTERVAL_MS })
    .catch((error: unknown) => {
      logger.error('could not schedule the recovery job', error);
    });

  const recoveryWorker = new Worker<void, RecoveryReport>(
    SCRIPT_RECOVERY_QUEUE,
    () => processScriptRecoveryJob({ flow, logger, graceMs: env.SCRIPT_RECOVERY_GRACE_MS }),
    { connection: redisConnectionOptions(), concurrency: 1 },
  );

  recoveryWorker.on('failed', (job, error) => {
    logger.error(`recovery job ${job?.id ?? 'unknown'} failed`, error.message);
  });

  recoveryWorker.on('error', (error) => {
    logger.warn('recovery worker error', error.message);
  });

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
    recoveryWorker,
    async close(): Promise<void> {
      await Promise.all([worker.close(), recoveryWorker.close()]);
      await Promise.all([recoveryQueue.close(), queues.close()]);
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

  await Promise.all([handle.worker.waitUntilReady(), handle.recoveryWorker.waitUntilReady()]);
  logger.info(
    `${SCRIPT_PARSING_QUEUE} worker ready (concurrency=${env.SCRIPT_PARSING_CONCURRENCY}), ` +
      `recovery every ${env.SCRIPT_RECOVERY_INTERVAL_MS} ms`,
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
