# 2026 Fantasy Football Draft Room

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
- Local storage preserves the active draft immediately. Prisma/SQLite provides
  a server-side persistence route when the database is initialized.
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
npm run db:push
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
by `CHEN_PPR_CSV_URL`, writes only successful responses to `data/cache`, and
falls back to the last successful cache. It does not scrape pages, bypass access
controls, or work around source restrictions.

Because source availability and schema can change, manual CSV import remains the
safe fallback. Confirm that your use of any third-party data complies with its
terms.

## Yahoo developer app and OAuth

1. Create an application at <https://developer.yahoo.com/apps/>.
2. Request Fantasy Sports private user data access. Read-only access is enough
   for the current adapter.
3. Set the callback URL to `http://localhost:3000/api/yahoo/callback`.
4. Copy only the client ID and secret into your uncommitted `.env`; never add
   access or refresh tokens to Git.
5. Set the full 2026 league key (Yahoo keys normally include the game key and
   league ID) after the league exists.

The read-only adapter in `src/adapters/yahoo/yahoo-api.ts` supports settings,
teams, draft results, and available players when supplied a valid OAuth bearer
token. The browser authorization/callback and encrypted refresh-token store are
intentionally remaining work; the simulation does not fake a Yahoo connection.
See `docs/YAHOO_LIMITATIONS.md`.

## Recommendation model

Weights live in `src/config/strategy.ts`. Each signal is normalized, multiplied
by its configured weight, and retained in the result as a factor breakdown.
Early kicker/defense and unnecessary backup QB/TE penalties are explicit. The
model uses no LLM-generated ranking or explanation.

The UI exposes the most important live adjustments. Edit the configuration file
for all defaults. The future automatic-behavior configuration is off by default,
and stale-sync guards are covered by unit tests.

## Project layout

See `docs/ARCHITECTURE.md`. Prisma stores serialized local sessions and confirmed
identity mappings in SQLite. Yahoo player IDs should become canonical only after
the identity resolver returns an exact result or the user confirms an ambiguous
mapping.

## Before trusting it in a live draft

- Replace synthetic fixtures with validated 2026 Chen data and review unmatched
  identities.
- Complete Yahoo OAuth callback, encrypted token persistence, player-response
  parsing, and UI reconciliation using a real 2026 test league.
- Measure how quickly Yahoo publishes active draft results and tune conservative
  polling/backoff behavior.
- Run a full dress rehearsal, including stale sync, conflicts, undo, refresh,
  and loss of network.
- Expand browser tests against production-sized rankings.

Yahoo has no documented live-draft pick submission operation. Confirm Pick is
local only. Do not reinterpret transaction or lineup endpoints as draft APIs.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
