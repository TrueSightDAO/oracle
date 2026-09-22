import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guard for the "full hexagram text missing from printed / PDF
 * output" bug. The full text (Intro / Judgment / Image / Lines) is rendered
 * inside a collapsed <details class="hexagram-fulltext">, and browsers do not
 * render collapsed <details> content when printing. The page therefore opens
 * every fulltext panel on `beforeprint` (CSS cannot force a <details> open)
 * and hides the now-meaningless "Read the full text" toggle when printing.
 */
describe('print includes full hexagram text', () => {
  const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');

  it('opens fulltext <details> panels on beforeprint and restores on afterprint', () => {
    expect(html).toContain('addEventListener("beforeprint", openFulltextForPrint)');
    expect(html).toContain('addEventListener("afterprint", restoreFulltextAfterPrint)');
    expect(html).toContain('function openFulltextForPrint()');
    expect(html).toContain('function restoreFulltextAfterPrint()');
    // targets the right element
    expect(html).toContain('details.hexagram-fulltext');
    // preserves the user's prior open/closed state
    expect(html).toContain('printWasClosed');
  });

  it('hides the "Read the full text" toggle when printing and avoids bad page breaks', () => {
    const printBlock = html.slice(html.indexOf('@media print'));
    expect(printBlock).toContain('.hexagram-fulltext > summary');
    expect(printBlock).toContain('display: none !important');
    expect(printBlock).toContain('break-inside: avoid');
  });

  it('keeps the full text inside the printed .fulltext-body (not the collapsed summary)', () => {
    // the renderer still writes Intro/Judgment/Image/Lines into .fulltext-body
    expect(html).toContain('className = "fulltext-body"');
    expect(html).toContain('className = "fulltext-section"');
  });
});
