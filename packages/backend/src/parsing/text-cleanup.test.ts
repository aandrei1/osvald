import { describe, expect, it } from 'vitest';

import { cleanupPages, splitPages, type PdfPage } from './text-cleanup.js';

/**
 * The cleanup pass is the first line of defence against OCR furniture: running
 * headers, folios, publisher straplines and footnotes all look like dialogue to
 * the parser unless they are removed first.
 */

describe('splitPages', () => {
  it('splits on the markers the OCR step writes', () => {
    const pages = splitPages('=== PAGINA 1 ===\nPrima pagină\n=== PAGINA 2 ===\nA doua');

    expect(pages).toEqual([
      { page: 1, text: 'Prima pagină\n' },
      { page: 2, text: 'A doua\n' },
    ]);
  });

  it('accepts the English marker and any casing', () => {
    expect(splitPages('=== pagina 3 ===\nText')).toEqual([{ page: 3, text: 'Text\n' }]);
    expect(splitPages('=== PAGE 4 ===\nText')).toEqual([{ page: 4, text: 'Text\n' }]);
  });

  it('treats text with no markers as a single page, so a .txt paste still parses', () => {
    expect(splitPages('linia unu\nlinia doi')).toEqual([
      { page: 1, text: 'linia unu\nlinia doi\n' },
    ]);
  });

  it('treats a malformed marker as ordinary content', () => {
    const pages = splitPages('=== PAGINA x ===\nText');

    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toContain('=== PAGINA x ===');
  });
});

describe('cleanupPages', () => {
  const noisyVolume = `=== PAGINA 1 ===
AVARUL
O scenă frumoasă începe aici.
Continuă cu asea-
mănă de bine.
12

=== PAGINA 2 ===
AVARUL
Text pe pagina doi.
Editura Minerva
13

=== PAGINA 3 ===
AVARUL
Text pe pagina trei.
1 Valère e gentilom napolitan (n.t.).
14
`;

  it('removes running headers, folios, publisher noise and footnotes', () => {
    const result = cleanupPages(splitPages(noisyVolume));

    expect(result.lines.map((line) => line.text)).toEqual([
      'O scenă frumoasă începe aici.',
      'Continuă cu aseamănă de bine.',
      'Text pe pagina doi.',
      'Text pe pagina trei.',
    ]);
    expect(result.pageCount).toBe(3);
    // AVARUL ×3, the two folios, the strapline, the footnote and the third folio.
    expect(result.droppedLines).toBe(8);
  });

  it('repairs typesetter hyphenation inside a page', () => {
    const pages: PdfPage[] = [{ page: 1, text: 'asea-\nmănă\n' }];

    expect(cleanupPages(pages).lines).toEqual([{ text: 'aseamănă', page: 1 }]);
  });

  it('does not mistake a dash at the end of a line for hyphenation', () => {
    const pages: PdfPage[] = [{ page: 1, text: 'zece-\nDar\n' }];

    expect(cleanupPages(pages).lines.map((line) => line.text)).toEqual(['zece-', 'Dar']);
  });

  it('never joins a word across a page break', () => {
    const pages: PdfPage[] = [
      { page: 1, text: 'asea-\n' },
      { page: 2, text: 'mănă\n' },
    ];

    expect(cleanupPages(pages).lines.map((line) => line.text)).toEqual(['asea-', 'mănă']);
  });

  it('keeps footnote-shaped text that is not in the bottom of the page', () => {
    const pages: PdfPage[] = [
      {
        page: 1,
        text: [
          '1 Un text care seamănă cu o notă de subsol.',
          'Linia doi.',
          'Linia trei.',
          'Linia patru.',
          'Linia cinci.',
          'Linia șase.',
          '',
        ].join('\n'),
      },
    ];

    expect(cleanupPages(pages).lines.map((line) => line.text)).toContain(
      '1 Un text care seamănă cu o notă de subsol.',
    );
  });

  it('drops the publisher straplines of this edition', () => {
    const pages: PdfPage[] = [
      { page: 1, text: 'Editura Minerva\nText.\n' },
      { page: 2, text: 'Biblioteca pentru toți\nText.\n' },
    ];

    expect(cleanupPages(pages).lines.map((line) => line.text)).toEqual(['Text.', 'Text.']);
  });

  it('returns an empty result for an empty document', () => {
    expect(cleanupPages([])).toEqual({ lines: [], droppedLines: 0, pageCount: 0 });
  });
});
