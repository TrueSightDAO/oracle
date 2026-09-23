#!/usr/bin/env python3
"""Regenerate the hybrid I Ching corpus with paragraph structure + OCR cleanup.

Design (why it is safe):
  * The served corpus text is the already-OCRed/cleaned prose. Re-extracting raw
    words from the scanned PDF regresses quality (word fragmentation, dropped
    letters), so we DO NOT re-OCR the words. We take the existing corpus prose as
    canonical and only:
      1. decode HTML entities in ``name`` (previously left as raw '&ecirc;');
      2. apply a curated OCR artifact map to the prose (stray list markers,
         mid-word insertions, glued page numbers, dropped leading letters);
      3. recover PARAGRAPH breaks from the source PDF press layout (a new
         paragraph is set with a first-line indent). Paragraphs are produced as
         exact contiguous slices of the prose, so no word can change.
  * Output joins paragraphs with a blank line (``\\n\\n``); index.html renders
    each paragraph as its own <p>.

Run:  python3 scripts/parse_walker_corpus.py [--pdf PATH]
Writes data/hexagram_texts_hybrid.json and scripts/hexagram_texts_hybrid.js.
"""
import argparse, json, re, sys
from collections import defaultdict

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover
    import pymupdf as fitz

# Curated OCR artifact map (order matters: specific before general).
TYPO = [
 (r'\bitfdJ\b',''),(r'\bI ChingitfdJ\b','I Ching'),(r'\bI Chingit\b','I Ching'),
 (r'\bchingitfdj\b','Ching'),
 (r'(?<=[a-z])\.\d{1,3}\b(?=\s+[A-Z])','.'),          # glued page number 'woods.15 The'
 (r'\s+\d{1,2}\s+itfdJ\s+[a-z]{1,2}\b',''),            # rotated page-label bleed
 (r'\bFlere\b','Here'),(r'\blere\b','here'),(r'\brecjuires\b','requires'),(r'\brecjuire\b','require'),
 (r'\bjoolish\b','foolish'),(r'\bjour\b','your'),(r'\bJor\b','for'),(r'\bJear\b','fear'),
 (r'\bJrom\b','from'),(r'\bJortune\b','fortune'),(r'\bpurijy\b','purify'),(r'\bshock oj\b','shock of'),
 (r'\boj\b','of'),(r'\bmode1\b','model'),(r'\b11 babes\b','babes'),
 (r'\bselfdevelop\w*','self development'),(r'\bselfcorrection\b','self-correction'),
 (r'\binf[^\w]?uences\b','influences'),(r'\bproj ects\b','projects'),(r'\bpush ing\b','pushing'),
 (r'\bneu trality\b','neutrality'),(r'\bdiscon tinue\b','discontinue'),(r'\bre maining\b','remaining'),
 (r'\bprinci ples\b','principles'),(r'\bw i th\b','with'),(r'\bstead fast\b','steadfast'),
 (r'\bover whelmed\b','overwhelmed'),(r'\badvan tage\b','advantage'),(r'\bUn known\b','Unknown'),
 (r'\bhen we\b','When we'),(r'\bhenever\b','Whenever'),(r'\bhen you\b','When you'),
 (r'\bnless\b','Unless'),(r'\beturn to\b','Return to'),(r'\bress\^ve\b','ressive'),(r'aressive','aggressive'),
 (r'\s+[io]\s+(?=[A-Za-z])',' '),                      # stray single-letter list markers
 (r'\u00a7+',''),(r'\u00ac',''),(r'(?<=[a-z])\^\s*',''),
 (r'prac-\s+tice','practice'),(r'medita-\s+\d*\*?\s*tion','meditation'),
 (r'A to B,6','A to B'),(r'\b\d\*\s*',''),
]
ENTITIES = {'&ecirc;':'ê','&uuml;':'ü','&acirc;':'â','&eacute;':'é','&egrave;':'è',
            '&agrave;':'à','&ocirc;':'ô','&imath;':'i'}


def fix(s: str) -> str:
    s = s.replace('\u2019', "'").replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')
    for a, b in TYPO:
        s = re.sub(a, b, s)
    return re.sub(r'\s+', ' ', s).strip()


def paragraph_start_texts(pdf):
    """Candidate first-lines of paragraphs, from the PDF press layout."""
    doc = fitz.open(pdf)
    rows, pg = [], defaultdict(list)
    for pi in range(doc.page_count):
        for blk in doc[pi].get_text("dict")['blocks']:
            if blk.get('type') != 0:
                continue
            for ln in blk['lines']:
                t = "".join(sp['text'] for sp in ln['spans'])
                x0, y0, x1, _ = ln['bbox']
                r = {'p': pi, 'x0': round(x0), 'x1': round(x1), 't': fix(t)}
                rows.append(r); pg[pi].append(r)
    rows.sort(key=lambda r: (r['p'], r['x0']))
    def margin(p):
        longs = [r['x0'] for r in pg[p] if (r['x1'] - r['x0']) > 250]
        return min(longs) if longs else 50
    starts = []
    for r in rows:
        t = r['t']
        if len(t) < 18 or not re.match(r'[A-Z0-9"\'(]', t):
            continue
        if r['x0'] > margin(r['p']) + 11:
            starts.append(t)
    return starts


def cut_paragraphs(prose, starts):
    low = prose.lower()
    cuts = set()
    for t in starts:
        key = ' '.join(t.split()[:4]).lower()
        if len(key) < 8:
            continue
        i = low.find(key)
        if i > 0:
            cuts.add(i)
    cuts = sorted(c for c in cuts if 0 < c < len(prose))
    filt = []
    for c in cuts:
        if not filt or c - filt[-1] >= 25:
            filt.append(c)
    out, prev = [], 0
    for c in filt:
        seg = prose[prev:c].strip()
        if seg:
            out.append(seg)
        prev = c
    tail = prose[prev:].strip()
    if tail:
        out.append(tail)
    return out or [prose]


def write_js(data, path='scripts/hexagram_texts_hybrid.js'):
    body = json.dumps(data, ensure_ascii=False, indent=2)
    js = ("\n/*\n * Hybrid I Ching corpus for all 64 hexagrams.\n"
          " *   Description + line readings: Brian Browne Walker,\n"
          " *     \"The I Ching or Book of Changes: A Guide to Life's Turning Points\"\n"
          " *     (St. Martin's Griffin, 1992). Translation (c) Brian Browne Walker.\n"
          " *   Judgment + Image: Richard Wilhelm / Cary F. Baynes,\n"
          " *     \"The I Ching or Book of Changes\" (Princeton/Bollingen, 1950/1967).\n"
          " * Auto-generated from data/hexagram_texts_hybrid.json - do not edit manually.\n"
          " */\n(function attachCorpus() {\n  window.hexagramTexts =\n"
          + '\n'.join('  ' + l for l in body.split('\n')) + "\n};\n})();\n")
    open(path, 'w', encoding='utf-8').write(js)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default='/tmp/tg_attachments/d6ccec14bbd8463a868effccbf87f804.pdf')
    args = ap.parse_args()
    starts = paragraph_start_texts(args.pdf)
    old = json.load(open('data/hexagram_texts_hybrid.json'))
    out = {}
    for n in range(1, 65):
        src = old[str(n)]
        name = src['name']
        for ent, ch in ENTITIES.items():
            name = name.replace(ent, ch)
        prose = fix(src['intro'])
        paras = cut_paragraphs(prose, starts)
        for p in paras:                       # invariant: paragraphs are slices
            assert p in prose, (n, p[:40])
        out[str(n)] = {
            'name': name,
            'intro': '\n\n'.join(paras),
            'judgment': src['judgment'],
            'image': src['image'],
            'lines': [fix(x) for x in src['lines']],
        }
    open('data/hexagram_texts_hybrid.json', 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    write_js(out)
    dist = defaultdict(int)
    for d in out.values():
        dist[d['intro'].count('\n\n') + 1] += 1
    print("paragraph-count distribution:", sorted(dist.items()))
    print("hexagrams w/ empty intro/lines:",
          [n for n in range(1, 65) if not out[str(n)]['intro'].strip()
           or any(not l.strip() for l in out[str(n)]['lines'])])
    return 0


if __name__ == '__main__':
    sys.exit(main())
