import type { RecoveryReport, ScriptProductionFlow } from '../../flows/script-production-flow.js';
import type { Logger } from '../../lib/logger.js';

/**
 * Periodic recovery of lost jobs.
 *
 * The truth about a script lives in Postgres, not in Redis, so this job reads
 * the database for runs stuck in a work stage and queues them again under the
 * same idempotent job id. It is a BullMQ job scheduler (repeatable job) rather
 * than a delayed job per run, because a delayed job would live in Redis too.
 */
export const SCRIPT_RECOVERY_QUEUE = 'script-recovery';
export const SCRIPT_RECOVERY_SCHEDULER_ID = 'recover-stuck-scripts';

export interface ScriptRecoveryContext {
  flow: ScriptProductionFlow;
  logger: Logger;
  graceMs: number;
}

export async function processScriptRecoveryJob(
  ctx: ScriptRecoveryContext,
): Promise<RecoveryReport> {
  const report = await ctx.flow.recoverStuckExtractions({ graceMs: ctx.graceMs });

  if (report.requeued > 0 || report.failed > 0) {
    ctx.logger.warn(
      `recovery: ${report.checked} stuck run(s), ${report.requeued} re-queued, ${report.failed} failed`,
    );
  }

  return report;
}
