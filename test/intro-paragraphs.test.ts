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
  // the JS assigns `window.hexagramTexts = {...};` (indented one level).
  // Walk brace depth (string-aware) to find the object's *actual* close,
  // rather than string-matching a fixed tail -- a hardcoded `lastIndexOf`
  // silently passes even when a stray extra/missing brace corrupts the file
  // (exactly what shipped in #69: an extra "}" threw a SyntaxError on load
  // and dropped window.hexagramTexts -- and every reading with it --
  // sitewide, while this test's old string-slice kept "parsing" fine because
  // it depended on that exact buggy tail shape). See scripts/parse_walker_corpus.py.
  function extractBalancedObject(src: string, openBraceIndex: number) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = openBraceIndex; i < src.length; i += 1) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return { text: src.slice(openBraceIndex, i + 1), endIndex: i + 1 };
        }
      }
    }
    throw new Error('unbalanced braces while extracting corpus object');
  }
  const anchor = js.indexOf('hexagramTexts');
  const { text: corpusText, endIndex } = extractBalancedObject(js, js.indexOf('{', anchor));
  const corpus = JSON.parse(corpusText);

  it('scripts/hexagram_texts_hybrid.js is syntactically valid and attaches window.hexagramTexts', () => {
    // The direct regression guard for #69's real bug: a stray extra "}"
    // made this file throw a SyntaxError on load, silently dropping every
    // reading sitewide with no visible error to a user. Executing the file
    // for real (not just slicing a substring out of it) is the only check
    // that actually catches that failure mode.
    const win: any = {};
    // eslint-disable-next-line no-new-func
    new Function('window', js)(win);
    expect(Object.keys(win.hexagramTexts ?? {})).toHaveLength(64);
  });

  it('the JSON object is exactly what remains after the assignment (no stray trailing braces)', () => {
    const tail = js.slice(endIndex);
    expect(tail.trimStart().startsWith(';')).toBe(true);
  });

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
