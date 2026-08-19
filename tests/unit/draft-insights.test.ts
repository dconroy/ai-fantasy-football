import { describe, expect, it } from "vitest";

import { analyzeDraftRoster } from "../../src/domain/draft-insights";
import type { Pick, Player, Position } from "../../src/domain/types";

function player(
  id: string,
  position: Position,
  overrides: Partial<Player> = {},
): Player {
  return {
    id,
    name: id,
    position,
    team: overrides.team ?? "BUF",
    ...overrides,
  };
}

function pick(
  overall: number,
  slot: number,
  drafted: Player,
  rosterSlot: Pick["rosterSlot"] = drafted.position,
): Pick {
  return {
    overall,
    round: Math.ceil(overall / 12),
    slot,
    player: drafted,
    rosterSlot,
  };
}

describe("analyzeDraftRoster", () => {
  it("flags three players sharing a bye week", () => {
    const report = analyzeDraftRoster(
      [
        pick(1, 1, player("Bijan", "RB", { byeWeek: 7 })),
        pick(24, 1, player("Achane", "RB", { byeWeek: 7 })),
        pick(25, 1, player("Evans", "WR", { byeWeek: 7 })),
      ],
      { currentRound: 3 },
    );
    expect(report.byes).toEqual([
      { week: 7, count: 3, names: ["Bijan", "Achane", "Evans"] },
    ]);
    expect(report.alerts.some((alert) => alert.id === "bye-7")).toBe(true);
    expect(report.alerts.find((alert) => alert.id === "bye-7")?.severity).toBe(
      "warning",
    );
  });

  it("escalates four players on the same bye to critical", () => {
    const report = analyzeDraftRoster(
      [
        pick(1, 1, player("A", "RB", { byeWeek: 10 })),
        pick(2, 1, player("B", "WR", { byeWeek: 10 })),
        pick(3, 1, player("C", "QB", { byeWeek: 10 })),
        pick(4, 1, player("D", "TE", { byeWeek: 10 })),
      ],
      { currentRound: 4 },
    );
    expect(report.alerts.find((alert) => alert.id === "bye-10")?.severity).toBe(
      "critical",
    );
  });

  it("warns when a mid-draft roster still has no RB", () => {
    const report = analyzeDraftRoster(
      [
        pick(5, 5, player("Chase", "WR", { byeWeek: 10 })),
        pick(20, 5, player("Jefferson", "WR", { byeWeek: 6 })),
      ],
      { currentRound: 5 },
    );
    expect(report.alerts.some((alert) => alert.id === "need-rb")).toBe(true);
  });

  it("warns on a three-player NFL team stack", () => {
    const report = analyzeDraftRoster(
      [
        pick(1, 1, player("Mahomes", "QB", { team: "KC", byeWeek: 6 })),
        pick(24, 1, player("Rice", "WR", { team: "KC", byeWeek: 6 })),
        pick(25, 1, player("Kelce", "TE", { team: "KC", byeWeek: 6 })),
      ],
      { currentRound: 3 },
    );
    expect(report.alerts.some((alert) => alert.id === "team-KC")).toBe(true);
  });

  it("warns when a kicker is drafted before the specialist round", () => {
    const report = analyzeDraftRoster(
      [pick(48, 1, player("Tucker", "K", { byeWeek: 7 }))],
      { currentRound: 4, specialistRound: { K: 13, DEF: 13 } },
    );
    expect(report.alerts.some((alert) => alert.id === "early-k")).toBe(true);
  });

  it("includes the model lean when provided", () => {
    const report = analyzeDraftRoster([], {
      currentRound: 1,
      topPick: { name: "Bijan Robinson", reason: "Fills an open RB" },
    });
    const lean = report.alerts.find((alert) => alert.id === "model-lean");
    expect(lean?.title).toBe("Model lean: Bijan Robinson");
    expect(lean?.detail).toBe("Fills an open RB");
  });
});
