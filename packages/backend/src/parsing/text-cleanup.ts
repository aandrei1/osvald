/**
 * Page-level cleanup applied before the script parser sees any text.
 *
 * OCR output of a printed play carries furniture that is not part of the play:
 * running headers, folio numbers, publisher straplines and footnotes. Leaving
 * them in would create phantom dialogue, so each page is filtered on its own —
 * that is the only level at which "first/last line of the page" is meaningful.
 */

/** `=== PAGINA 12 ===` separators, written by the OCR step. */
const PAGE_MARKER = /^===\s*(?:PAGINA|PAGE)\s+(\d+)\s*===$/i;

/** A folio number alone on a line. */
const FOLIO_ONLY = /^[\divxlcIVXLC]{1,6}$/;

/**
 * Footnote bodies, e.g. `1 Valère e gentilom napolitan (n.t.).` — a digit, then
 * prose. Only matched near the bottom of a page, where footnotes live.
 */
const FOOTNOTE = /^\d{1,2}\s+\p{Lu}[\p{L}\s,.;:'’“”"()-]{10,}$/u;

/** Publisher strapline repeated on every verso of this edition. */
const PUBLISHER_NOISE = [/^\d{0,3}\s*de\s+cărți\s+pe\s+care/i, /^biblioteca\b/i, /^editura\b/i];

export interface PdfPage {
  /** 1-based page number as printed by the extractor. */
  page: number;
  text: string;
}

/**
 * Splits raw extractor output on `=== PAGINA n ===` markers.
 *
 * Text with no markers at all is treated as a single page, so a plain `.txt`
 * paste still parses.
 */
export function splitPages(raw: string): PdfPage[] {
  const lines = raw.split(/\r?\n/);
  const pages: PdfPage[] = [];
  let current: PdfPage | undefined;

  for (const line of lines) {
    const marker = PAGE_MARKER.exec(line.trim());

    if (marker !== null) {
      const pageNumber = Number(marker[1]);
      current = { page: Number.isFinite(pageNumber) ? pageNumber : pages.length + 1, text: '' };
      pages.push(current);
      continue;
    }

    if (current === undefined) {
      current = { page: 1, text: '' };
      pages.push(current);
    }

    current.text += `${line}\n`;
  }

  return pages;
}

/**
 * Collects the lines that repeat on many pages — in this edition `Avarul`,
 * `Tartuffe` and the publisher strapline. A line is furniture when it shows up
 * near the top or bottom of at least `minPages` different pages.
 */
function detectRunningHeaders(pages: PdfPage[], minPages: number): Set<string> {
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Only the margins of the page can hold a running header or footer.
    const margins = [...lines.slice(0, 2), ...lines.slice(-2)];

    for (const line of new Set(margins)) {
      if (line.length > 60) {
        continue;
      }
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const headers = new Set<string>();
  for (const [line, count] of counts) {
    if (count >= minPages) {
      headers.add(line);
    }
  }

  return headers;
}

function isNoise(line: string, runningHeaders: Set<string>): boolean {
  if (line.length === 0) {
    return true;
  }
  if (runningHeaders.has(line)) {
    return true;
  }
  if (FOLIO_ONLY.test(line)) {
    return true;
  }
  // OCR artefacts: a lone dash or a page that only held a decoration.
  if (/^[—–\-_.•*]{1,4}$/.test(line)) {
    return true;
  }
  return PUBLISHER_NOISE.some((pattern) => pattern.test(line));
}

/** One content line, still tied to the page it came from. */
export interface CleanLine {
  text: string;
  /** 1-based source page, so scenes can report a page range. */
  page: number;
}

/**
 * Rejoins a word split across a line break by the typesetter's hyphenation,
 * e.g. `asea-\nmănă` → `aseamănă`. A hyphen that ends a line is only treated as
 * hyphenation when the next line starts lowercase — `zece-\nDar` is a dash.
 */
function dehyphenate(lines: CleanLine[]): CleanLine[] {
  const out: CleanLine[] = [];

  for (const line of lines) {
    const previous = out[out.length - 1];

    if (previous !== undefined && /\p{Ll}-$/u.test(previous.text) && /^\p{Ll}/u.test(line.text)) {
      previous.text = previous.text.slice(0, -1) + line.text;
      continue;
    }

    out.push({ ...line });
  }

  return out;
}

export interface CleanupResult {
  /** Content lines, page furniture removed, hyphenation repaired. */
  lines: CleanLine[];
  /** How many lines were dropped as noise — reported in the job result. */
  droppedLines: number;
  /** Highest page number seen in the source. */
  pageCount: number;
}

/**
 * Turns extractor output into the flat line stream the parser consumes.
 *
 * TODO(parsing): a two-column scan interleaves columns and would need the OCR
 * bounding boxes to reorder. The current OCR step already sorts by reading
 * order per page, which is enough for single-column play texts.
 */
export function cleanupPages(pages: PdfPage[]): CleanupResult {
  // Scale with the document: on a 3-page excerpt "repeats 8 times" never hits.
  const minPages = Math.max(3, Math.floor(pages.length * 0.15));
  const runningHeaders = detectRunningHeaders(pages, minPages);

  const lines: CleanLine[] = [];
  let droppedLines = 0;
  let pageCount = 0;

  for (const page of pages) {
    pageCount = Math.max(pageCount, page.page);

    const pageLines = page.text.split('\n').map((line) => line.trim());
    const kept: CleanLine[] = [];

    for (const [index, line] of pageLines.entries()) {
      // Footnotes sit in the bottom third; the same shape mid-page is dialogue.
      const inFootnoteZone = index >= pageLines.length - 4;

      if (isNoise(line, runningHeaders) || (inFootnoteZone && FOOTNOTE.test(line))) {
        if (line.length > 0) {
          droppedLines += 1;
        }
        continue;
      }

      kept.push({ text: line, page: page.page });
    }

    // Hyphenation is repaired per page: a word broken across a page break would
    // otherwise be rejoined across the discarded header lines.
    lines.push(...dehyphenate(kept));
  }

  return { lines, droppedLines, pageCount };
}
