import type { LossSummary } from '@osvald/shared';
import { describe, expect, it } from 'vitest';

import { describeLoss } from './loss-summary';

const NOTHING: LossSummary = {
  sceneCount: 0,
  lineCount: 0,
  characterCount: 0,
  editedLineCount: 0,
  synthesizedCharacterCount: 0,
};

describe('describeLoss', () => {
  it('names the lines a reparse replaces and the genders it keeps', () => {
    expect(
      describeLoss({ ...NOTHING, sceneCount: 1, lineCount: 2, characterCount: 1 }, 'reparse'),
    ).toEqual(['Replaces 2 lines in 1 scene, 1 character.', 'Genders you set by hand are kept.']);
  });

  it('warns about hand corrections and generated audio', () => {
    expect(
      describeLoss({ ...NOTHING, editedLineCount: 1, synthesizedCharacterCount: 1200 }, 'delete'),
    ).toEqual([
      'Your corrections to 1 line are lost.',
      `${(1200).toLocaleString()} characters of generated audio are lost.`,
    ]);
  });

  it('says nothing about lines when a script has none yet', () => {
    expect(describeLoss(NOTHING, 'delete')).toEqual([]);
  });
});
