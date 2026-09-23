import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guards for the hexagram intro rendering bugs:
 *   - intros were flattened into a single run-on block (no paragraph breaks)
 *   - some `name` fields held raw HTML entities and rendered literally
 */
describe('hexagram intro renders as paragraphs', () => {
  const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
  const js = readFileSync(
    resolve(__dirname, '..', 'scripts', 'hexagram_texts_hybrid.js'),
    'utf-8'
  );
  // the JS assigns `window.hexagramTexts = {...};` (indented one level)
  const anchor = js.indexOf('hexagramTexts');
  const corpus = JSON.parse(
    js.slice(js.indexOf('{', anchor), js.lastIndexOf('\n};'))
  );

  it('renders each intro paragraph as its own <p>, not one run-on block', () => {
    // split on blank line(s) into <p> elements
    expect(html).toContain('introText.split(/\\n{2,}/)');
    expect(html).toContain('introBody.className = "fulltext-intro"');
    // no longer injects the whole intro into a single innerHTML div
    expect(html).not.toContain('`<strong>Intro:</strong><div>${introText}</div>`');
  });

  it('corpus joins multi-paragraph intros with a blank line', () => {
    const multi = Object.values<any>(corpus).filter(
      (h) => typeof h.intro === 'string' && h.intro.includes('\n\n')
    );
    expect(multi.length).toBe(Object.keys(corpus).length);
  });

  it('no served field contains a raw HTML entity', () => {
    const fields = ['name', 'intro', 'judgment', 'image'];
    const offenders: string[] = [];
    for (const [num, h] of Object.entries<any>(corpus)) {
      for (const f of fields) {
        if (typeof h[f] === 'string' && /&[a-zA-Z]+;/.test(h[f])) {
          offenders.push(`${num}.${f}`);
        }
      }
      for (const l of h.lines ?? []) {
        if (typeof l === 'string' && /&[a-zA-Z]+;/.test(l)) {
          offenders.push(`${num}.lines`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every hexagram has a non-empty intro and six line readings', () => {
    for (const [num, h] of Object.entries<any>(corpus)) {
      expect(h.intro.trim().length, `hex ${num} intro`).toBeGreaterThan(0);
      expect(h.lines.length, `hex ${num} lines`).toBe(6);
    }
  });
});
