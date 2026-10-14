import { Queue } from 'bullmq';

import type { Logger } from '../lib/logger.js';
import { redisConnectionOptions } from './connection.js';
import {
  SCRIPT_PARSING_QUEUE,
  type ScriptParsingJobData,
  type ScriptParsingJobResult,
} from './jobs/script-parsing.js';

/**
 * Queue registry, decorated onto the Fastify instance as `app.queues`.
 *
 * Queues are created eagerly but BullMQ connects in the background
 * (`skipWaitingForReady`), so the API still boots when Redis is briefly
 * unavailable — `/health` reports the outage instead.
 *
 * NOTE: the registry type is derived from this factory (`ReturnType<...>`)
 * rather than written out by hand, because BullMQ's `Queue` class carries seven
 * generic parameters and hand-written instantiations do not compare equal.
 */
export function createQueueRegistry(logger: Logger) {
  const scriptParsing = new Queue<ScriptParsingJobData, ScriptParsingJobResult>(
    SCRIPT_PARSING_QUEUE,
    {
      connection: redisConnectionOptions(),
      skipWaitingForReady: true,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        // Keep failures around so the UI can show why parsing broke.
        removeOnFail: false,
      },
    },
  );

  scriptParsing.on('error', (error: Error) => {
    logger.warn('script-parsing queue error', error.message);
  });

  return {
    scriptParsing,
    async close(): Promise<void> {
      await scriptParsing.close();
    },
  };
}

export type QueueRegistry = ReturnType<typeof createQueueRegistry>;
