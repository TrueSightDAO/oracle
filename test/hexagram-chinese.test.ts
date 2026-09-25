import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Guards the classical Chinese hexagram characters (卦名):
 *   - scripts/hexagram_chinese.js must map all 64 King Wen numbers
 *   - index.html must load it, render it, and forward it to the advisor
 */
describe('hexagram Chinese characters', () => {
  const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf-8');
  const mapJs = readFileSync(
    resolve(__dirname, '..', 'scripts', 'hexagram_chinese.js'),
    'utf-8'
  );

  const CJK = /[\u3400-\u9FFF]/;

  function loadMap(): Record<string, string> {
    const win: any = {};
    // eslint-disable-next-line no-new-func
    new Function('window', mapJs)(win);
    return win.hexagramChinese ?? {};
  }

  it('maps every King Wen number 1..64 to a Chinese character', () => {
    const map = loadMap();
    const missing: string[] = [];
    for (let n = 1; n <= 64; n += 1) {
      const cn = map[String(n)];
      if (typeof cn !== 'string' || !CJK.test(cn)) missing.push(String(n));
    }
    expect(Object.keys(map)).toHaveLength(64);
    expect(missing).toEqual([]);
  });

  it('anchors the well-known hexagrams to the correct character', () => {
    const map = loadMap();
    expect(map['1']).toBe('乾');   // The Creative
    expect(map['2']).toBe('坤');   // The Receptive
    expect(map['11']).toBe('泰');  // Peace
    expect(map['64']).toBe('未濟'); // Before Completion
  });

  it('uses the traditional form, not the simplified fallback', () => {
    // Content elsewhere in the oracle is traditional; do not silently serve simplified.
    const map = loadMap();
    expect(map['22']).toBe('賁');   // not 贲
    expect(map['63']).toBe('既濟'); // not 既济
    expect(map['61']).toBe('中孚');
  });

  it('index.html loads the map script before the corpus and draw script', () => {
    const mapIdx = html.indexOf('scripts/hexagram_chinese.js');
    expect(mapIdx).toBeGreaterThan(-1);
    expect(mapIdx).toBeLessThan(html.indexOf('scripts/hexagram_texts_hybrid.js'));
  });

  it('index.html renders the character (heading + reference grid)', () => {
    expect(html).toContain('function hexagramChinese(');
    expect(html).toContain('hexagram-name-chinese');
    expect(html).toContain('reference-cell-chinese');
  });

  it('index.html forwards the characters to the oracle advisory request', () => {
    expect(html).toContain('params.set("primary_chinese"');
    expect(html).toContain('params.set("related_chinese"');
  });

  it('formatHexagramTitle surfaces the character before the English name', () => {
    const titleFn = html.slice(html.indexOf('function formatHexagramTitle('));
    const body = titleFn.slice(0, titleFn.indexOf('\n      }'));
    expect(body).toContain('${hexagram.number}');
    expect(body).toContain('–'); // literal en-dash separator in the source
    expect(body).toContain('cn ? cn + " " : ""');
  });
});
