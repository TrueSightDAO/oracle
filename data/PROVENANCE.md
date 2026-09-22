# Hexagram text corpus — provenance

## Active corpus (what the site serves)

`data/hexagram_texts_hybrid.json` → `scripts/hexagram_texts_hybrid.js`
(loaded by `index.html` and `draw.html`).

A **hybrid** reading combining two translations, each supplying the register the
other lacks:

| Block | Source |
|---|---|
| Description (`intro`) | **Brian Browne Walker** |
| Line readings (`lines`) | **Brian Browne Walker** |
| Judgment (`judgment`) | **Richard Wilhelm / Cary F. Baynes** |
| Image (`image`) | **Richard Wilhelm / Cary F. Baynes** |

- Walker: *The I Ching or Book of Changes: A Guide to Life's Turning Points*
  (St. Martin's Griffin, 1992). Translation © Brian Browne Walker.
- Wilhelm/Baynes: *The I Ching or Book of Changes* (Princeton/Bollingen, 1950/1967).

Structure: `{ "<n>": { name, intro, judgment, image, lines[6] } }`. Walker's text
provides a single modern description plus six line readings; Wilhelm/Baynes provides
the classical Judgment and its poetic Image. All four fields are populated for all
64 hexagrams.

**Transcription / merge notes.** Walker text was transcribed from a two-column
publisher scan and cleaned of OCR apparatus (running headers, page numbers,
trigram-diagram captions, and each next-hexagram title that bled into the preceding
line). Wilhelm/Baynes `judgment` and `image` were carried over from the original
corpus; two damaged `image` entries (#13, #52) were re-extracted from the source
`data/wilhelm.html`. Names keep the PDF's HTML entities (e.g. `T'ung J&ecirc;n`) as
rendered.

## Kept (not served)

- `data/hexagram_texts_walker.json` → `scripts/hexagram_texts_walker.js` —
  Walker-only corpus (description + lines; `judgment`/`image` empty).
- `data/hexagram_texts.json` → `scripts/hexagram_texts.js` — original Wilhelm/Baynes
  corpus, retained verbatim as a backup. To roll back, point the `<script src>` in
  `index.html`/`draw.html` back at `scripts/hexagram_texts.js`.
