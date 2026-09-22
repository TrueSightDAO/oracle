# Hexagram text corpus — provenance

## Active corpus (what the site serves)

`data/hexagram_texts_walker.json` → `scripts/hexagram_texts_walker.js`
(loaded by `index.html` and `draw.html`).

Source: **Brian Browne Walker**, *The I Ching or Book of Changes: A Guide to Life's
Turning Points* (St. Martin's Griffin, 1992). Translation © Brian Browne Walker.
Extracted from the publisher PDF; all **64 hexagrams** and **6 line-explanation
readings** per hexagram.

Structure: `{ "<n>": { name, intro, judgment, image, lines[6] } }`. Walker's text carries a
single description plus six line explanations, so `judgment` and `image` are empty
strings — the site renders `intro` as the description and `lines[]` as the line readings.

Regenerate with: `python3 scripts/parse_walker_corpus.py` (reads the PDF, writes the
JSON + JS).

## Backup corpus (kept, not served)

`data/hexagram_texts.json` → `scripts/hexagram_texts.js` — the original
**Wilhelm/Baynes** translation, retained verbatim as a backup. To roll back, point the
`<script src>` in `index.html`/`draw.html` back at `scripts/hexagram_texts.js`.
