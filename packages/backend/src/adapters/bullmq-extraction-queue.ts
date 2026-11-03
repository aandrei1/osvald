import type {
  EnqueueOutcome,
  ExtractionJob,
  ExtractionQueue,
  RunRef,
} from '../ports/extraction-queue.js';
import type { QueueRegistry } from '../queue/queues.js';

/** BullMQ job name used by the producer; the worker handles every job on the queue. */
export const EXTRACTION_JOB_NAME = 'parse-script';

/**
 * Job id for one run. BullMQ rejects `:` in custom ids (it is its key
 * separator), hence `_` between the two UUIDs.
 */
export function extractionJobId(run: RunRef): string {
  return `${run.scriptId}_${run.runId}`;
}

type ScriptParsingQueue = Pick<QueueRegistry['scriptParsing'], 'add' | 'getJob'>;

/** `ExtractionQueue` on the `script-parsing` BullMQ queue. */
export function createBullmqExtractionQueue(queue: ScriptParsingQueue): ExtractionQueue {
  return {
    async enqueue(job: ExtractionJob): Promise<EnqueueOutcome> {
      const jobId = extractionJobId(job);
      const existing = await queue.getJob(jobId);

      if (existing !== undefined) {
        // BullMQ silently ignores an `add` whose id already exists. A completed
        // job must therefore be removed before the run can be queued again;
        // any other state means the run is still being handled.
        if ((await existing.getState()) !== 'completed') {
          return 'already_queued';
        }
        await existing.remove();
      }

      await queue.add(
        EXTRACTION_JOB_NAME,
        { scriptId: job.scriptId, runId: job.runId, filePath: job.filePath },
        { jobId },
      );
      return 'added';
    },

    async failureOf(run: RunRef): Promise<string | null> {
      const existing = await queue.getJob(extractionJobId(run));

      if (existing === undefined || (await existing.getState()) !== 'failed') {
        return null;
      }

      return existing.failedReason.length > 0
        ? existing.failedReason
        : 'The extraction job failed without a reason';
    },
  };
}
