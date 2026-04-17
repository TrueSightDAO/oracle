# oracle_advisory_bridge — GAS backend

GAS project: https://script.google.com/home/projects/1_jTHZZI033E0y2TQNZg98N_bW6lNP2I9sLA__nNQEWpRAw2Q6vsn9DsL/edit  
Deployed web app: `GAS_ORACLE_ADVISORY_URL` in `iching_oracle/index.html`

## What it does

Receives hexagram draw params from `oracle.truesight.me`, fetches three context sources from raw GitHub, builds a Grok prompt, and returns `{ok, advice, model, generated_at_utc}`.

**Context sources (fetched on every oracle_advice call):**

| Source | Raw URL | Update cadence |
|--------|---------|----------------|
| `ADVISORY_SNAPSHOT.md` | `agentic_ai_context/main/ADVISORY_SNAPSHOT.md` | Daily (GitHub Actions) |
| `advisory/BASE.md` | `ecosystem_change_logs/main/advisory/BASE.md` | Manual |
| `reminders/current.json` | `ecosystem_change_logs/main/reminders/current.json` | End-of-day (local `--with-rem`) |

## Deploy

```bash
cd iching_oracle/gas
npm install -g @google/clasp   # once
clasp login                    # once
clasp push
```

Then open the GAS editor → Deploy → New deployment → Web app (execute as me, anyone can access).  
Copy the new deployment URL into `GAS_ORACLE_ADVISORY_URL` in `index.html` if it changed.

Run `runOneSetup()` once from the editor after first push to grant UrlFetch + Properties permissions.

## Script Properties (set in GAS editor → Project Settings → Script Properties)

| Key | Required | Default |
|-----|----------|---------|
| `XAI_API_KEY` | Yes | — |
| `XAI_MODEL` | No | `grok-3-mini` |
| `ORACLE_SHARED_SECRET` | No | (open access) |

## Reminders sync

Open reminders are written to `ecosystem_change_logs/reminders/current.json` by running locally:

```bash
cd market_research
python3 scripts/generate_advisory_snapshot.py --with-rem --git-publish
```

This is part of the end-of-day workflow. GitHub Actions runs the same script **without** `--with-rem` (no `rem` CLI in CI), so reminders are only updated when you run locally.
