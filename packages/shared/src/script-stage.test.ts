import { describe, expect, it } from 'vitest';

import {
  SCRIPT_FLOW_STEPS,
  SCRIPT_STAGES,
  SCRIPT_TRANSITIONS,
  canRunStep,
  isRehearsableStage,
  isWorkStage,
} from './script-stage.js';

/**
 * The transition table is the contract both sides read: the backend enforces
 * it, the frontend uses it to hide buttons. These tests pin the rows of the
 * table in `docs/plans/script-production-flow.md`.
 */

describe('SCRIPT_TRANSITIONS', () => {
  it('has a row for every flow step', () => {
    expect(Object.keys(SCRIPT_TRANSITIONS).sort()).toEqual([...SCRIPT_FLOW_STEPS].sort());
  });

  it('lets reparse and delete run from every stage', () => {
    for (const stage of SCRIPT_STAGES) {
      expect(canRunStep('reparse', stage)).toBe(true);
      expect(canRunStep('delete', stage)).toBe(true);
    }
  });

  it('only completes or fails an extraction that is running', () => {
    expect(SCRIPT_STAGES.filter((stage) => canRunStep('onExtractionCompleted', stage))).toEqual([
      'extracting',
    ]);
    expect(SCRIPT_STAGES.filter((stage) => canRunStep('onExtractionFailed', stage))).toEqual([
      'extracting',
    ]);
  });

  it('submits for synthesis only from review or a ready script', () => {
    expect(SCRIPT_STAGES.filter((stage) => canRunStep('submitForSynthesis', stage))).toEqual([
      'in_review',
      'ready',
    ]);
  });

  it('stops synthesis from both synthesizing and a paused budget', () => {
    expect(SCRIPT_STAGES.filter((stage) => canRunStep('stopSynthesis', stage))).toEqual([
      'synthesizing',
      'paused_budget',
    ]);
  });

  it('never runs startImport on an existing script', () => {
    for (const stage of SCRIPT_STAGES) {
      expect(canRunStep('startImport', stage)).toBe(false);
    }
  });
});

describe('stage groups', () => {
  it('treats extraction and synthesis as work in progress', () => {
    expect(SCRIPT_STAGES.filter(isWorkStage)).toEqual(['extracting', 'synthesizing']);
  });

  it('allows rehearsal once lines exist', () => {
    expect(SCRIPT_STAGES.filter(isRehearsableStage)).toEqual([
      'in_review',
      'synthesizing',
      'paused_budget',
      'ready',
    ]);
  });
});
