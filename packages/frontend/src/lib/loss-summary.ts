import type { LossSummary } from '@osvald/shared';

/**
 * Wording for the confirmation of a destructive command.
 *
 * Plain functions, like `script.ts`, so the dialog text can be tested without
 * mounting the page.
 */

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What a reparse or a delete would remove, as one sentence per kind of loss. */
export function describeLoss(summary: LossSummary, action: 'reparse' | 'delete'): string[] {
  const parts: string[] = [];

  if (summary.lineCount > 0) {
    const what =
      `${plural(summary.lineCount, 'line', 'lines')} in ` +
      `${plural(summary.sceneCount, 'scene', 'scenes')}, ` +
      `${plural(summary.characterCount, 'character', 'characters')}`;
    parts.push(action === 'reparse' ? `Replaces ${what}.` : `Removes ${what}.`);
  }

  if (summary.editedLineCount > 0) {
    parts.push(`Your corrections to ${plural(summary.editedLineCount, 'line', 'lines')} are lost.`);
  }

  if (summary.synthesizedCharacterCount > 0) {
    parts.push(
      `${plural(summary.synthesizedCharacterCount, 'character', 'characters')} of generated audio ` +
        (action === 'reparse' ? 'are kept only for lines that come out identical.' : 'are lost.'),
    );
  }

  if (action === 'reparse') {
    parts.push('Genders you set by hand are kept.');
  }

  return parts;
}
