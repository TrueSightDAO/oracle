# Hexagram text corpus — provenance

## Active corpus (what the site serves)

`data/hexagram_texts_walker.json` → `scripts/hexagram_texts_walker.js`
(loaded by `index.html` and `draw.html`).

Source: **Brian Browne Walker**, *The I Ching or Book of Changes: A Guide to Life's
Turning Points* (St. Martin's Griffin, 1992). Translation © Brian Browne Walker.
Transcribed from the publisher PDF: **64 hexagrams** and **384 line explanations**.

Structure: `{ "<n>": { name, intro, judgment, image, lines[6] } }`. Walker's text carries a
single description plus six line explanations, so `judgment` and `image` are empty
strings — the site renders `intro` as the description and `lines[]` as the line readings.

**Transcription notes.** The source is a two-column scan; text was extracted in reading
order and cleaned of OCR apparatus (running headers, page numbers, trigram-diagram
captions, and each next-hexagram title that bled into the preceding line). Names keep the
PDF's HTML entities (e.g. `T'ung J&ecirc;n`) as rendered. A final manual pass handled the
handful of pages where a line cue itself was OCR-mangled (e.g. `FIFTH FINE` → `FIFTH LINE`).

## Backup corpus (kept, not served)

`data/hexagram_texts.json` → `scripts/hexagram_texts.js` — the original **Wilhelm/Baynes**
translation, retained verbatim as a backup. To roll back, point the `<script src>` in
`index.html`/`draw.html` back at `scripts/hexagram_texts.js`.
