import { z } from 'zod';

/**
 * Where a script is in its production flow: import → review → synthesis.
 *
 * The stage is the real thread of the flow. It lives on the script row, and
 * every command or job reaction moves it with a conditional update, so nothing
 * has to stay in memory while the work happens elsewhere.
 *
 *   extracting     OCR + parsing run on the queue worker
 *   in_review      lines are in; the editor checks text, genders and voices
 *   synthesizing   Azure audio is being generated in the background
 *   paused_budget  synthesis stopped because the month's character budget ran out
 *   ready          every Azure-voiced line has up-to-date audio
 *   failed         extraction gave up after its last attempt (see `parseError`)
 */
export const SCRIPT_STAGES = [
  'extracting',
  'in_review',
  'synthesizing',
  'paused_budget',
  'ready',
  'failed',
] as const;
export const scriptStageSchema = z.enum(SCRIPT_STAGES);
export type ScriptStage = z.infer<typeof scriptStageSchema>;

/** Stages in which a job is (or should be) working; recovery re-queues these. */
export const SCRIPT_WORK_STAGES = [
  'extracting',
  'synthesizing',
] as const satisfies readonly ScriptStage[];
export type ScriptWorkStage = (typeof SCRIPT_WORK_STAGES)[number];

/** Stages with lines to rehearse. Lines without Azure audio use the offline voices. */
export const SCRIPT_REHEARSABLE_STAGES = [
  'in_review',
  'synthesizing',
  'paused_budget',
  'ready',
] as const satisfies readonly ScriptStage[];

export function isWorkStage(stage: ScriptStage): stage is ScriptWorkStage {
  return (SCRIPT_WORK_STAGES as readonly ScriptStage[]).includes(stage);
}

export function isRehearsableStage(stage: ScriptStage): boolean {
  return (SCRIPT_REHEARSABLE_STAGES as readonly ScriptStage[]).includes(stage);
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

/** Commands come from people; `on…` reactions come from jobs. */
export const SCRIPT_FLOW_STEPS = [
  'startImport',
  'onExtractionCompleted',
  'onExtractionFailed',
  'reparse',
  'submitForSynthesis',
  'onSynthesisCompleted',
  'onSynthesisPaused',
  'stopSynthesis',
  'resumeSynthesis',
  'delete',
] as const;
export type ScriptFlowStep = (typeof SCRIPT_FLOW_STEPS)[number];

interface Transition {
  /** `null` for `startImport`, which creates the script. `'any'` allows every stage. */
  from: readonly ScriptStage[] | 'any' | null;
  /** `null` for `delete`, which removes the row. */
  to: ScriptStage | null;
}

/**
 * The flow's transition table, defined once for the backend (which enforces it)
 * and the frontend (which only uses it to hide buttons).
 *
 * `submitForSynthesis` from `ready` is only meaningful when lines went stale;
 * that extra condition is checked by the flow, not by this table.
 */
export const SCRIPT_TRANSITIONS = {
  startImport: { from: null, to: 'extracting' },
  onExtractionCompleted: { from: ['extracting'], to: 'in_review' },
  onExtractionFailed: { from: ['extracting'], to: 'failed' },
  reparse: { from: 'any', to: 'extracting' },
  submitForSynthesis: { from: ['in_review', 'ready'], to: 'synthesizing' },
  onSynthesisCompleted: { from: ['synthesizing'], to: 'ready' },
  onSynthesisPaused: { from: ['synthesizing'], to: 'paused_budget' },
  stopSynthesis: { from: ['synthesizing', 'paused_budget'], to: 'in_review' },
  resumeSynthesis: { from: ['paused_budget'], to: 'synthesizing' },
  delete: { from: 'any', to: null },
} as const satisfies Record<ScriptFlowStep, Transition>;

/** Whether `step` may run while the script is in `stage`. */
export function canRunStep(step: ScriptFlowStep, stage: ScriptStage): boolean {
  const from: Transition['from'] = SCRIPT_TRANSITIONS[step].from;

  if (from === null) {
    return false;
  }

  return from === 'any' || from.includes(stage);
}

/* -------------------------------------------------------------------------- */
/* Events and summaries                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a destructive command (reparse, delete) would throw away, shown to the
 * editor before they confirm.
 */
export const lossSummarySchema = z.object({
  /** Scenes, lines and characters that will be replaced or removed. */
  sceneCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  /** Lines whose text the editor corrected by hand. */
  editedLineCount: z.number().int().nonnegative(),
  /** Azure characters already spent on this script's audio. */
  synthesizedCharacterCount: z.number().int().nonnegative(),
});
export type LossSummary = z.infer<typeof lossSummarySchema>;
