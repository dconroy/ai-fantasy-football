# Architecture

- `src/domain`: framework-independent snake draft, roster, identity, and
  recommendation logic.
- `src/config/strategy.ts`: every recommendation weight and safety default.
- `src/adapters/chen`: replaceable CSV adapter plus server-side fetch/cache.
- `src/adapters/yahoo`: read-only OAuth bearer-token API boundary. It
  intentionally has no pick-submission method.
- `src/persistence`: Prisma/SQLite client. The UI also mirrors simulation state
  to local storage so a database outage does not erase an active mock draft.
- `src/app`: Next.js routes and desktop-first React interface.

The recommendation engine ranks a bounded player list from numeric factors. It
does not ask an LLM to rank or narrate players. Explanations are generated from
the same factor breakdown used to calculate each score.

Player identity starts with normalized names and position/team evidence, then
promotes a confirmed Yahoo player ID to the internal identifier. Ambiguous or
unmatched candidates are review items, never automatic matches.
