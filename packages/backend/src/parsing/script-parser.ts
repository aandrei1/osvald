/**
 * Play text → scenes / characters / lines.
 *
 * The parser is deliberately heuristic rather than grammar-driven: printed plays
 * have no machine-readable structure, only typographic convention. It targets
 * the conventions of published stage plays (Romanian and English editions):
 *
 *   ACTUL II            act heading, resets the scene counter
 *   SCENA 3             scene heading
 *   Valère, Élise       optional cast line right after the heading → scene title
 *   HARPAGON:           speaker label, uppercase, colon-terminated
 *   Cum aşa, ...        dialogue, wrapped over as many lines as the column needs
 *   (Aici apar ...)     stage direction, possibly spanning several lines
 *
 * Everything the parser cannot classify is attached to the dialogue line it
 * follows, which keeps text from being silently lost.
 */

import { cleanupPages, splitPages, type CleanLine } from './text-cleanup.js';

/* -------------------------------------------------------------------------- */
/* Output shape                                                               */
/* -------------------------------------------------------------------------- */

export interface ParsedLine {
  type: 'dialogue' | 'direction';
  /** Speaker exactly as printed, e.g. `JUPÂNUL JACQUES`. `null` for directions. */
  speakerLabel: string | null;
  /** Canonical character name this line belongs to, `null` for directions. */
  characterName: string | null;
  text: string;
}

export interface ParsedScene {
  /** Printed marker, e.g. `Actul 2 · Scena 3`. */
  number: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  lines: ParsedLine[];
}

export interface ParsedCharacter {
  name: string;
  /** Cast-list note, when the document has a `PERSONAJELE` page. */
  description: string | null;
  /** Every distinct printed spelling seen for this character. */
  aliases: string[];
}

export interface ParseStats {
  pageCount: number;
  droppedLines: number;
  /** Lines that could not be attributed to a speaker. */
  orphanLines: number;
}

export interface ParsedScript {
  scenes: ParsedScene[];
  characters: ParsedCharacter[];
  stats: ParseStats;
}

/* -------------------------------------------------------------------------- */
/* Recognisers                                                                */
/* -------------------------------------------------------------------------- */

const ACT_HEADING = /^(?:ACTUL|ACT|ACTE)\s*([0-9]{1,2}|[IVXLC]{1,6})\s*[.:]?$/i;
const SCENE_HEADING = /^(?:SCENA|SCENE|SCENA\.)\s*([0-9]{1,2}|[IVXLC]{1,6})\s*[.:]?$/i;
const CAST_HEADING = /^(?:PERSONAJELE|PERSONAJE|PERSOANELE|CHARACTERS|DRAMATIS\s+PERSONAE)\s*:?$/i;
/** Ends the cast list in this edition: `Acțiunea se desfăşoară la Paris.` */
const CAST_LIST_END = /^(?:AC[ȚT]IUNEA|SCENE\s*:|THE\s+SCENE)/i;

const MAX_SPEAKER_LABEL_LENGTH = 48;

/** Comparison key: case- and diacritic-insensitive, letters only. */
export function characterKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/**
 * True when `head` looks like a printed speaker label.
 *
 * The decisive signal is the absence of lowercase letters: play texts set
 * speaker names in caps or small caps, and no ordinary sentence survives that
 * test. `Actul 1` and cast lines like `Valère, Élise` are rejected here.
 */
function isSpeakerLabel(head: string): boolean {
  if (head.length === 0 || head.length > MAX_SPEAKER_LABEL_LENGTH) {
    return false;
  }
  if (/\p{Ll}/u.test(head)) {
    return false;
  }
  // At least two letters, so `I:` or a stray `1:` is not a speaker.
  const letters = head.match(/\p{Lu}/gu) ?? [];
  if (letters.length < 2) {
    return false;
  }
  // Only letters, marks, spaces and the punctuation that appears inside names.
  return /^[\p{Lu}\p{M}\p{Nd}\s.'’\-,]+$/u.test(head);
}

interface SpeakerMatch {
  label: string;
  /** Text printed after the colon on the same line, if any. */
  inlineText: string;
  /** Parenthetical between name and colon: `SGANAREL (aparte):`. */
  inlineDirection: string | null;
}

/**
 * Splits a speaker line into name, delivery note and remaining text.
 *
 *   HARPAGON: Nimic, tată.                      → label, inlineText
 *   SGANAREL (ţinând o tabacheră):              → label, inlineDirection
 *
 * The name part may not contain a colon or a parenthesis, which is what keeps
 * ordinary prose with a mid-sentence colon from matching.
 */
const SPEAKER_LINE = /^([^():[\]]{1,48}?)\s*(\([^)]*\)|\[[^\]]*\])?\s*:\s*(.*)$/u;

function matchSpeaker(line: string): SpeakerMatch | null {
  const match = SPEAKER_LINE.exec(line);
  if (match === null) {
    return null;
  }

  const head = (match[1] ?? '').trim();
  if (!isSpeakerLabel(head)) {
    return null;
  }

  const direction = match[2]?.trim();

  // `COMISARUL, SECRETARUL` is a two-speaker heading in some editions; keeping
  // only the first name would be wrong, so the whole label is preserved.
  return {
    label: head.replace(/[,.\s]+$/u, ''),
    inlineText: (match[3] ?? '').trim(),
    inlineDirection: direction !== undefined && direction.length > 0 ? direction : null,
  };
}

/** A line that opens a stage direction. */
function isDirectionStart(line: string): boolean {
  return line.startsWith('(') || line.startsWith('[');
}

function isDirectionComplete(buffer: string): boolean {
  const opens = (buffer.match(/[([]/g) ?? []).length;
  const closes = (buffer.match(/[)\]]/g) ?? []).length;
  return closes >= opens;
}

/**
 * A list of names printed directly under a scene heading, e.g. `Valère, Élise`
 * or `Doamna Pernelle și Flipote, servitoarea sa,`. Used as the scene title.
 *
 * Roles are often annotated (`servitoarea sa`), so only a majority of the
 * comma-separated parts needs to read like a name. Prose is excluded by the
 * terminal-punctuation test: a cast line never ends in a full stop.
 */
function isSceneCastLine(line: string, continuing = false): boolean {
  if (line.length === 0 || line.length > 110) {
    return false;
  }
  if (isDirectionStart(line) || line.includes(':')) {
    return false;
  }
  if (/[.!?]$/.test(line)) {
    return false;
  }

  const parts = line
    .split(/,|\be?t\b|\bși\b|\bsi\b|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0 || parts.some((part) => part.length > 34)) {
    return false;
  }

  // A list already known to be unfinished (the previous line ended on a comma)
  // may continue with a lowercase role, as in `doamna Claude, jupânul Jacques,`.
  if (continuing) {
    return true;
  }

  const namedParts = parts.filter((part) => /^\p{Lu}/u.test(part)).length;
  return namedParts >= Math.ceil(parts.length / 2);
}

/**
 * Rejoins a speaker label whose delivery note was broken across the column:
 *
 *   HARPAGON (zbiară după hoț chiar din grădină și vine fără
 *   pălărie):
 *
 * Without this the colon never lands on the label's line, the speaker is missed
 * and the whole speech below it is left unattributed. Only an unmistakable
 * label followed by an unclosed parenthesis is joined, and never across more
 * than `MAX_LABEL_WRAP` lines.
 */
const MAX_LABEL_WRAP = 3;
const UNCLOSED_LABEL = /^([^():[\]]{1,48}?)\s*[([][^)\]]*$/u;

function joinWrappedSpeakerLabels(lines: CleanLine[]): CleanLine[] {
  const out: CleanLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const match = UNCLOSED_LABEL.exec(line.text);

    if (match === null || !isSpeakerLabel((match[1] ?? '').trim())) {
      out.push({ ...line });
      continue;
    }

    let joined = line.text;
    let consumed = 0;

    while (consumed < MAX_LABEL_WRAP) {
      const next = lines[index + consumed + 1];
      if (next === undefined) {
        break;
      }

      consumed += 1;
      joined += ` ${next.text}`;

      if (next.text.includes(')') || next.text.includes(']')) {
        break;
      }
    }

    // Only accept the join if it actually produced a speaker line.
    if (consumed > 0 && matchSpeaker(joined) !== null) {
      out.push({ text: joined, page: line.page });
      index += consumed;
      continue;
    }

    out.push({ ...line });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Cast list                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reads a `PERSONAJELE` page into characters with their printed notes.
 *
 * Entries wrap, so a continuation line (starting lowercase) is appended to the
 * previous entry's description.
 */
function parseCastList(lines: CleanLine[]): Map<string, ParsedCharacter> {
  const cast = new Map<string, ParsedCharacter>();

  let inCastList = false;
  let current: ParsedCharacter | undefined;

  for (const { text } of lines) {
    if (CAST_HEADING.test(text)) {
      inCastList = true;
      continue;
    }
    if (!inCastList) {
      continue;
    }
    if (CAST_LIST_END.test(text) || ACT_HEADING.test(text) || SCENE_HEADING.test(text)) {
      break;
    }
    if (text.length === 0) {
      continue;
    }

    // Continuation of the previous entry's note.
    if (current !== undefined && /^\p{Ll}/u.test(text)) {
      current.description = current.description === null ? text : `${current.description} ${text}`;
      continue;
    }

    // `HARPAGON, tatăl lui Cléante…` — name, then an optional note.
    const comma = text.indexOf(',');
    const rawName = (comma === -1 ? text : text.slice(0, comma)).trim();
    const note = comma === -1 ? null : text.slice(comma + 1).trim();

    if (rawName.length === 0 || rawName.length > MAX_SPEAKER_LABEL_LENGTH) {
      continue;
    }

    const key = characterKey(rawName);
    if (key.length === 0) {
      continue;
    }

    current = {
      name: toDisplayName(rawName),
      description: note !== null && note.length > 0 ? note : null,
      aliases: [rawName],
    };
    cast.set(key, current);
  }

  return cast;
}

/**
 * `HARPAGON` → `Harpagon`, `LA FLÈCHE` → `La Flèche`.
 *
 * Printed labels are all-caps, which reads as shouting in the UI. Names that
 * are already mixed-case (from a cast list) are left alone.
 */
export function toDisplayName(raw: string): string {
  const trimmed = raw.trim().replace(/[,.\s]+$/u, '');

  if (/\p{Ll}/u.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .toLocaleLowerCase('ro-RO')
    .replace(
      /(^|[\s'’\-])(\p{L})/gu,
      (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('ro-RO'),
    );
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

interface SceneBuilder {
  number: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  lines: ParsedLine[];
}

/**
 * Parses one play.
 *
 * Returns at least one scene for any non-empty input: a document with no
 * recognisable scene headings (a screenplay, an excerpt) becomes a single scene
 * so the rehearsal view still has something to work with.
 */
export function parseScriptText(raw: string): ParsedScript {
  const cleanup = cleanupPages(splitPages(raw));
  const { droppedLines, pageCount } = cleanup;
  const lines = joinWrappedSpeakerLabels(cleanup.lines);

  const cast = parseCastList(lines);
  const scenes: SceneBuilder[] = [];

  let act: string | null = null;
  let scene: SceneBuilder | undefined;
  let currentSpeaker: { label: string; name: string } | null = null;
  /** Index of the dialogue line that trailing text should be appended to. */
  let openDialogue: ParsedLine | null = null;
  let directionBuffer: { text: string; page: number } | null = null;
  /**
   * How many further lines may still be absorbed into the scene title. A cast
   * list wraps, so `Doamna Pernelle și Flipote, servitoarea sa,` continues on
   * the next line.
   */
  let castLineBudget = 0;
  let orphanLines = 0;
  let pastFrontMatter = false;

  const startScene = (number: string, page: number): SceneBuilder => {
    const next: SceneBuilder = {
      number,
      title: number,
      pageStart: page,
      pageEnd: page,
      lines: [],
    };
    scenes.push(next);
    currentSpeaker = null;
    openDialogue = null;
    return next;
  };

  const resolveCharacter = (label: string): string => {
    const key = characterKey(label);
    const known = cast.get(key);

    if (known !== undefined) {
      if (!known.aliases.includes(label)) {
        known.aliases.push(label);
      }
      return known.name;
    }

    const created: ParsedCharacter = {
      name: toDisplayName(label),
      description: null,
      aliases: [label],
    };
    cast.set(key, created);
    return created.name;
  };

  const flushDirection = (): void => {
    if (directionBuffer === null || scene === undefined) {
      directionBuffer = null;
      return;
    }

    scene.lines.push({
      type: 'direction',
      speakerLabel: null,
      characterName: null,
      text: directionBuffer.text.trim(),
    });
    scene.pageEnd = directionBuffer.page;
    // A direction does not end the current speech: dialogue may resume under it.
    openDialogue = null;
    directionBuffer = null;
  };

  for (const { text, page } of lines) {
    if (text.length === 0) {
      continue;
    }

    // A multi-line stage direction swallows everything until it is balanced.
    if (directionBuffer !== null) {
      directionBuffer.text += ` ${text}`;
      directionBuffer.page = page;

      if (isDirectionComplete(directionBuffer.text)) {
        flushDirection();
      }
      continue;
    }

    const actMatch = ACT_HEADING.exec(text);
    if (actMatch !== null) {
      act = `Actul ${actMatch[1]}`;
      pastFrontMatter = true;
      continue;
    }

    const sceneMatch = SCENE_HEADING.exec(text);
    if (sceneMatch !== null) {
      const label = `Scena ${sceneMatch[1]}`;
      scene = startScene(act === null ? label : `${act} · ${label}`, page);
      castLineBudget = 4;
      pastFrontMatter = true;
      continue;
    }

    // Front matter (title page, cast list) belongs to no scene.
    if (!pastFrontMatter) {
      continue;
    }

    if (scene === undefined) {
      scene = startScene(act ?? 'Scena 1', page);
    }

    if (castLineBudget > 0) {
      castLineBudget -= 1;

      if (isSceneCastLine(text, scene.title.endsWith(','))) {
        scene.title = scene.title === scene.number ? text : `${scene.title} ${text}`;
        // Keep absorbing only while the list is visibly unfinished.
        if (!scene.title.endsWith(',')) {
          castLineBudget = 0;
        }
        continue;
      }

      castLineBudget = 0;
    }

    if (isDirectionStart(text)) {
      directionBuffer = { text, page };

      if (isDirectionComplete(text)) {
        flushDirection();
      }
      continue;
    }

    const speaker = matchSpeaker(text);
    if (speaker !== null) {
      const name = resolveCharacter(speaker.label);
      currentSpeaker = { label: speaker.label, name };

      // A delivery note printed with the name is its own direction line, so the
      // rehearsal view can show it without feeding it to the speech engine.
      if (speaker.inlineDirection !== null) {
        scene.lines.push({
          type: 'direction',
          speakerLabel: null,
          characterName: null,
          text: speaker.inlineDirection,
        });
      }

      openDialogue = {
        type: 'dialogue',
        speakerLabel: speaker.label,
        characterName: name,
        text: speaker.inlineText,
      };
      scene.lines.push(openDialogue);
      scene.pageEnd = page;
      continue;
    }

    // Continuation of the current speech.
    if (openDialogue !== null) {
      openDialogue.text = openDialogue.text.length === 0 ? text : `${openDialogue.text} ${text}`;
      scene.pageEnd = page;
      continue;
    }

    // Dialogue resuming after a stage direction keeps the same speaker.
    if (currentSpeaker !== null) {
      openDialogue = {
        type: 'dialogue',
        speakerLabel: currentSpeaker.label,
        characterName: currentSpeaker.name,
        text,
      };
      scene.lines.push(openDialogue);
      scene.pageEnd = page;
      continue;
    }

    // Text before any speaker in the scene: keep it as an unattributed line
    // rather than dropping it, so nothing disappears silently.
    orphanLines += 1;
    scene.lines.push({
      type: 'direction',
      speakerLabel: null,
      characterName: null,
      text,
    });
    scene.pageEnd = page;
  }

  flushDirection();

  const parsedScenes: ParsedScene[] = scenes
    .filter((candidate) => candidate.lines.length > 0)
    .map((candidate) => ({
      number: candidate.number,
      // A wrapped cast list leaves a dangling separator on the title.
      title: candidate.title.replace(/[,;\s]+$/u, ''),
      pageStart: candidate.pageStart,
      pageEnd: candidate.pageEnd,
      lines: candidate.lines
        .map((line) => ({ ...line, text: line.text.trim() }))
        .filter((line) => line.text.length > 0),
    }));

  mergeOcrVariants(parsedScenes, cast);

  // Only characters that actually speak are useful for casting a rehearsal;
  // cast-list entries with no lines (`COMISARUL și SECRETARUL său`) are dropped.
  const speaking = new Set(
    parsedScenes.flatMap((parsedScene) =>
      parsedScene.lines
        .map((line) => line.characterName)
        .filter((name): name is string => name !== null),
    ),
  );

  const characters = [...cast.values()]
    .filter((character) => speaking.has(character.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'ro-RO'));

  return {
    scenes: parsedScenes,
    characters,
    stats: { pageCount, droppedLines, orphanLines },
  };
}

/**
 * Folds characters whose names differ only by an OCR slip into one role — this
 * edition yields both `Sganarel` and `Sganarell`.
 *
 * The rule is deliberately narrow: one extra trailing character on a name of at
 * least five letters. Anything looser starts collapsing genuinely different
 * roles (`Don Carlos` / `Don Louis`), and a wrongly merged role is far worse in
 * rehearsal than a duplicated one.
 */
function mergeOcrVariants(scenes: ParsedScene[], cast: Map<string, ParsedCharacter>): void {
  const lineCounts = new Map<string, number>();

  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.characterName !== null) {
        lineCounts.set(line.characterName, (lineCounts.get(line.characterName) ?? 0) + 1);
      }
    }
  }

  // Most-spoken name wins, so the canonical spelling is the common one.
  const ranked = [...cast.values()].sort(
    (left, right) => (lineCounts.get(right.name) ?? 0) - (lineCounts.get(left.name) ?? 0),
  );

  const winners: ParsedCharacter[] = [];
  const renames = new Map<string, string>();

  for (const character of ranked) {
    const key = characterKey(character.name);

    const winner = winners.find((candidate) => {
      const candidateKey = characterKey(candidate.name);
      const [shorter, longer] =
        candidateKey.length <= key.length ? [candidateKey, key] : [key, candidateKey];

      return (
        shorter.length >= 5 && longer.length - shorter.length === 1 && longer.startsWith(shorter)
      );
    });

    if (winner === undefined) {
      winners.push(character);
      continue;
    }

    renames.set(character.name, winner.name);
    for (const alias of character.aliases) {
      if (!winner.aliases.includes(alias)) {
        winner.aliases.push(alias);
      }
    }
    cast.delete(key);
  }

  if (renames.size === 0) {
    return;
  }

  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.characterName === null) {
        continue;
      }
      const renamed = renames.get(line.characterName);
      if (renamed !== undefined) {
        line.characterName = renamed;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Omnibus volumes                                                            */
/* -------------------------------------------------------------------------- */

export interface WorkSegment {
  /** Best guess at the play's title, from the running header or the cast page. */
  title: string | null;
  raw: string;
}

/**
 * Splits a volume holding several plays (`Avarul / Tartuffe / Don Juan`) into
 * one segment per play.
 *
 * The signal is an act counter that restarts: once `Actul 2` has been seen, a
 * following `Actul 1` can only be a new work. Used by the seed importer; the
 * upload path treats a PDF as one play.
 */
export function splitIntoWorks(raw: string): WorkSegment[] {
  const pages = splitPages(raw);
  const boundaries: number[] = [];
  let highestAct = 0;

  for (const [index, page] of pages.entries()) {
    for (const line of page.text.split('\n')) {
      const match = ACT_HEADING.exec(line.trim());
      if (match === null) {
        continue;
      }

      const actNumber = romanOrArabic(match[1] ?? '');
      if (actNumber === null) {
        continue;
      }

      if (actNumber === 1 && highestAct > 1) {
        boundaries.push(index);
        highestAct = 1;
        continue;
      }

      highestAct = Math.max(highestAct, actNumber);
    }
  }

  const starts = [0, ...boundaries];
  const segments: WorkSegment[] = [];

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? pages.length;
    const slice = pages.slice(start, end);

    segments.push({
      title: guessTitle(slice),
      raw: slice.map((page) => `=== PAGINA ${page.page} ===\n${page.text}`).join(''),
    });
  }

  return segments;
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanOrArabic(token: string): number | null {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  if (!/^[IVXLC]+$/i.test(token)) {
    return null;
  }

  const upper = token.toUpperCase();
  let total = 0;

  for (const [index, char] of [...upper].entries()) {
    const value = ROMAN_VALUES[char] ?? 0;
    const next = ROMAN_VALUES[upper[index + 1] ?? ''] ?? 0;
    total += value < next ? -value : value;
  }

  return total;
}

/**
 * The title of a play in a collection is the line repeated as the running
 * header on its pages — the most frequent short line in the segment.
 */
function guessTitle(pages: ReturnType<typeof splitPages>): string | null {
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 2 && line.length <= 40);

    for (const line of new Set([...lines.slice(0, 2), ...lines.slice(-2)])) {
      if (/\d/.test(line) || ACT_HEADING.test(line) || SCENE_HEADING.test(line)) {
        continue;
      }
      if (/^\p{Lu}+$/u.test(characterKey(line)) && line === line.toUpperCase()) {
        // All-caps margin lines are speaker labels, not titles.
        continue;
      }
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const best = ranked[0];

  return best !== undefined && best[1] >= 3 ? best[0] : null;
}
