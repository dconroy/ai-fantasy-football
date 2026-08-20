import { describe, expect, it } from "vitest";

import {
  isDraftPoll,
  mergePollPlayers,
  playerRevision,
} from "../../src/lib/board-sync";
import type { Player } from "../../src/domain";

const current: readonly Player[] = [
  {
    id: "cmc",
    name: "Christian McCaffrey",
    position: "RB",
    team: "SF",
  },
];

const incoming: readonly Player[] = [
  {
    id: "chase",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
  },
];

describe("playerRevision", () => {
  it("changes when rankings are re-imported, not when picks move", () => {
    const first = playerRevision("2026-08-19T00:00:00.000Z", "FantasyPros PPR");
    const sameBoard = playerRevision("2026-08-19T00:00:00.000Z", "FantasyPros PPR");
    const newImport = playerRevision("2026-08-19T12:00:00.000Z", "FantasyPros PPR");
    const newSource = playerRevision("2026-08-19T00:00:00.000Z", "Boris Chen PPR");
    expect(first).toBe(sameBoard);
    expect(first).not.toBe(newImport);
    expect(first).not.toBe(newSource);
  });
});

describe("isDraftPoll", () => {
  it("treats a heartbeat with since or playersRev as a poll", () => {
    expect(isDraftPoll({})).toBe(false);
    expect(isDraftPoll({ since: "2026-08-19T00:00:00.000Z" })).toBe(true);
    expect(isDraftPoll({ playersRev: "rev" })).toBe(true);
  });
});

describe("mergePollPlayers", () => {
  it("keeps the local board when the poll omitted players", () => {
    expect(
      mergePollPlayers(current, { playersOmitted: true, players: incoming }),
    ).toBe(current);
    expect(mergePollPlayers(current, { unchanged: true })).toBe(current);
    expect(mergePollPlayers(current, {})).toBe(current);
  });

  it("takes a fresh ranking list when the server sent one", () => {
    expect(mergePollPlayers(current, { players: incoming })).toBe(incoming);
  });
});
