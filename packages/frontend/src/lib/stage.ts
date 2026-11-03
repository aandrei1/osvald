import type { ScriptStage } from '@osvald/shared';

/** How a script's stage reads in the library and on the script page. */
export const STAGE_LABELS: Record<ScriptStage, string> = {
  extracting: 'reading…',
  in_review: 'in review',
  synthesizing: 'generating audio…',
  paused_budget: 'audio paused',
  ready: 'ready',
  failed: 'failed',
};

/** Ionic colour per stage: is it ready to rehearse yet? */
export const STAGE_COLORS: Record<ScriptStage, string> = {
  extracting: 'warning',
  in_review: 'success',
  synthesizing: 'warning',
  paused_budget: 'medium',
  ready: 'success',
  failed: 'danger',
};
