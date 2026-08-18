# 2026 Fantasy Football Draft Room

Not a developer? Read [HOW-IT-WORKS.md](HOW-IT-WORKS.md) instead — it explains
the whole app in plain English.

A local, desktop-first 12-team full-PPR snake draft assistant. The first version
focuses on a reliable simulation and a transparent, framework-independent
recommendation engine. It never submits a draft pick to Yahoo.

The built-in rankings are synthetic demonstration data, not 2026 advice. Import
a current Boris Chen PPR CSV before relying on rankings.

## What works

- Select any draft slot from 1–12 and simulate a 15-round snake draft.
- Drafted players disappear; picks, roster slots, and the board update
  immediately.
- Five recommendations recalculate from Chen rank/tier, tier cliffs, position
  need/scarcity, roster balance, turn distance, optional ADP, estimated return
  probability, and minor team/bye concentration.
- The UI shows factor-derived explanations and compares recommendation #1 with
  the next two choices.
- Confirm a recommendation locally, mark any player drafted, undo the latest
  pick, pin targets, avoid players, search/filter, and change key weights.
- Local storage preserves the active draft immediately. Prisma/Neon Postgres
  synchronizes the active session across devices.
- Import CSV manually or ask the server adapter to retrieve/cache the configured
  public Chen PPR file. Source and import timestamps are visible.
- Export draft results as JSON or CSV. Light and dark themes are included.
- Automatic selection is unavailable and disabled.

## Setup

Requires Node.js 20.9 or newer (Node 22 LTS recommended).

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>. To use the included CSV fallback, import
`public/data/sample-chen-ppr.csv`.

Tests and checks:

```bash
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

## Ranking data

`src/adapters/chen/boris-chen.ts` is the replaceable source adapter. It
preserves tier, position-specific rank, overall rank, team, bye, and optional
ADP from supported CSV columns. The fetch route uses the public URL configured
by `CHEN_PPR_CSV_URL`, stores only successful responses in Postgres, and falls
back to the last successful cache. It does not scrape pages, bypass access
controls, or work around source restrictions.

Because source availability and schema can change, manual CSV import remains the
safe fallback. Confirm that your use of any third-party data complies with its
terms.

## Yahoo developer app and OAuth

1. Create an application at <https://developer.yahoo.com/apps/>.
2. Request Fantasy Sports API access at <https://sports.yahoo.com/developer/access/>.
3. Set the callback URL to
   `https://draft.conroy.dev/api/yahoo/callback`.
4. Copy only the client ID and secret into your uncommitted `.env`; never add
   access or refresh tokens to Git.
5. Set the full 2026 league key (Yahoo keys normally include the game key and
   league ID) after the league exists.

The adapter supports settings, teams, draft results, and available players.
`/api/yahoo/auth` starts OAuth; access and refresh tokens are encrypted with
AES-256-GCM before storage in Postgres. Yahoo may return `403` until the
application is approved for Fantasy Sports. See `docs/YAHOO_LIMITATIONS.md`.

## Recommendation model

Weights live in `src/config/strategy.ts`. Each signal is normalized, multiplied
by its configured weight, and retained in the result as a factor breakdown.
Early kicker/defense and unnecessary backup QB/TE penalties are explicit. The
model uses no LLM-generated ranking or explanation.

The UI exposes the most important live adjustments. Edit the configuration file
for all defaults. The future automatic-behavior configuration is off by default,
and stale-sync guards are covered by unit tests.

## Project layout

See `docs/ARCHITECTURE.md`. Prisma stores shared sessions, encrypted OAuth
credentials, sync checkpoints, and confirmed identity mappings in Postgres.
Yahoo player IDs should become canonical only after
the identity resolver returns an exact result or the user confirms an ambiguous
mapping.

## Before trusting it in a live draft

- Replace synthetic fixtures with validated 2026 Chen data and review unmatched
  identities.
- Complete player-response parsing and UI reconciliation using a real 2026 test
  league after Yahoo approves API access.
- Measure how quickly Yahoo publishes active draft results and tune conservative
  polling/backoff behavior.
- Run a full dress rehearsal, including stale sync, conflicts, undo, refresh,
  and loss of network.
- Expand browser tests against production-sized rankings.

Yahoo has no documented live-draft pick submission operation. Confirm Pick is
local only. Do not reinterpret transaction or lineup endpoints as draft APIs.
