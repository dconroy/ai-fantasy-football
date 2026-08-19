import { describe, expect, it } from "vitest";

import { buildDraftReport, letterGrade } from "../../src/domain/draft-report";
import type { DraftState, Pick, Player, Position } from "../../src/domain";

function player(
  name: string,
  position: Position,
  chenRank: number,
  overrides: Partial<Player> = {},
): Player {
  return {
    id: name,
    name,
    position,
    team: "KC",
    chenRank,
    ...overrides,
  };
}

function pick(
  overall: number,
  drafted: Player,
  rosterSlot: Pick["rosterSlot"] = drafted.position,
): Pick {
  return {
    overall,
    round: Math.ceil(overall / 12),
    slot: 1,
    player: drafted,
    rosterSlot,
  };
}

describe("draft report card", () => {
  it("maps composite scores onto letter grades", () => {
    expect(letterGrade(0.9)).toBe("A");
    expect(letterGrade(0.67)).toBe("B");
    expect(letterGrade(0.2)).toBe("F");
  });

  it("flags steals, reaches, and starter holes", () => {
    const draft: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [
        pick(1, player("ReachWR", "WR", 80)),
        pick(24, player("Stud", "RB", 3)),
        pick(25, player("QB One", "QB", 25)),
        pick(48, player("WR Two", "WR", 40)),
        pick(49, player("TE One", "TE", 50)),
        pick(72, player("Kick", "K", 140)),
      ],
    };

    const report = buildDraftReport(draft);
    expect(report.complete).toBe(false);
    const slot1 = report.teams.find((team) => team.slot === 1);
    expect(slot1?.steal?.name).toBe("Stud");
    expect(slot1?.reach?.name).toBe("ReachWR");
    expect(slot1?.holes).toContain("No DEF");
    expect(slot1?.holes).toContain("1/2 RB");
  });
});
