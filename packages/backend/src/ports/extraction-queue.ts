/** One run of one script's work stage. Job reactions carry it back to the flow. */
export interface RunRef {
  scriptId: string;
  runId: string;
}

/** Everything the extraction job needs; the job reports back through the flow. */
export interface ExtractionJob extends RunRef {
  /** Absolute path of the stored upload. */
  filePath: string;
}

/** `added` when a job was created, `already_queued` when the run already had one. */
export type EnqueueOutcome = 'added' | 'already_queued';

/**
 * Where extraction work is handed off (BullMQ in production).
 *
 * Enqueueing is idempotent per run: the job id is derived from the script and
 * run ids, so the recovery job can re-enqueue a stuck run without duplicating
 * one that is still waiting or running.
 */
export interface ExtractionQueue {
  enqueue(job: ExtractionJob): Promise<EnqueueOutcome>;
  /** Why the run's job failed for good, or `null` when it did not (or is unknown). */
  failureOf(run: RunRef): Promise<string | null>;
}
