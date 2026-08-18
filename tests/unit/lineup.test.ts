import { describe, expect, it } from "vitest";
import {
  isUnplayable,
  lineupSlotsFromYahoo,
  optimizeLineup,
  type LineupPlayer,
} from "@/domain/lineup";

const SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 };

let nextId = 0;
function player(overrides: Partial<LineupPlayer>): LineupPlayer {
  nextId += 1;
  return {
    id: `p${nextId}`,
    name: `Player ${nextId}`,
    position: "RB",
    team: "KC",
    selectedSlot: "BN",
    ...overrides,
  };
}

function fullRoster(): LineupPlayer[] {
  return [
    player({ name: "QB One", position: "QB", selectedSlot: "QB", chenRank: 10 }),
    player({ name: "RB One", position: "RB", selectedSlot: "RB", chenRank: 5 }),
    player({ name: "RB Two", position: "RB", selectedSlot: "RB", chenRank: 20 }),
    player({ name: "RB Three", position: "RB", selectedSlot: "BN", chenRank: 60 }),
    player({ name: "WR One", position: "WR", selectedSlot: "WR", chenRank: 8 }),
    player({ name: "WR Two", position: "WR", selectedSlot: "WR", chenRank: 15 }),
    player({ name: "WR Three", position: "WR", selectedSlot: "WR", chenRank: 30 }),
    player({ name: "WR Four", position: "WR", selectedSlot: "W/R/T", chenRank: 45 }),
    player({ name: "TE One", position: "TE", selectedSlot: "TE", chenRank: 40 }),
    player({ name: "K One", position: "K", selectedSlot: "K", chenRank: 150 }),
    player({ name: "DEF One", position: "DEF", selectedSlot: "DEF", chenRank: 160 }),
  ];
}

describe("lineupSlotsFromYahoo", () => {
  it("maps Yahoo roster position labels including flex", () => {
    const slots = lineupSlotsFromYahoo({
      QB: 1, RB: 2, WR: 3, TE: 1, "W/R/T": 1, K: 1, DEF: 1, BN: 6, IR: 2,
    });
    expect(slots).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 });
  });
});

describe("isUnplayable", () => {
  it("flags OUT, IR, and bye-week players", () => {
    expect(isUnplayable(player({ status: "O" }))).toBe(true);
    expect(isUnplayable(player({ status: "IR-R" }))).toBe(true);
    expect(isUnplayable(player({ byeWeek: 7 }), 7)).toBe(true);
    expect(isUnplayable(player({ byeWeek: 7 }), 8)).toBe(false);
    expect(isUnplayable(player({ status: "Q" }))).toBe(false);
  });
});

describe("optimizeLineup", () => {
  it("keeps an already-optimal lineup and suggests no moves", () => {
    const result = optimizeLineup({ players: fullRoster(), slots: SLOTS });
    expect(result.moves).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
    const flex = result.starters.find((entry) => entry.slot === "FLEX");
    expect(flex?.player?.name).toBe("WR Four");
  });

  it("benches an OUT starter and raises a critical alert", () => {
    const roster = fullRoster().map((entry) =>
      entry.name === "RB One" ? { ...entry, status: "O" } : entry,
    );
    const result = optimizeLineup({ players: roster, slots: SLOTS });
    const rbStarters = result.starters
      .filter((entry) => entry.slot === "RB")
      .map((entry) => entry.player?.name);
    expect(rbStarters).not.toContain("RB One");
    expect(rbStarters).toContain("RB Three");
    const move = result.moves.find((item) => item.start.name === "RB Three");
    expect(move?.bench?.name).toBe("RB One");
    expect(move?.reason).toContain("ruled OUT");
    expect(
      result.alerts.some(
        (alert) => alert.severity === "critical" && alert.message.includes("RB One"),
      ),
    ).toBe(true);
  });

  it("treats a bye-week starter as unplayable for the given week", () => {
    const roster = fullRoster().map((entry) =>
      entry.name === "WR One" ? { ...entry, byeWeek: 9 } : entry,
    );
    const result = optimizeLineup({ players: roster, slots: SLOTS, currentWeek: 9 });
    const wrStarters = result.starters
      .filter((entry) => entry.slot === "WR")
      .map((entry) => entry.player?.name);
    expect(wrStarters).not.toContain("WR One");
    expect(
      result.alerts.some(
        (alert) => alert.severity === "critical" && alert.message.includes("on bye"),
      ),
    ).toBe(true);
  });

  it("promotes a benched player who out-ranks a starter", () => {
    const roster = fullRoster().map((entry) => {
      if (entry.name === "RB Three") return { ...entry, chenRank: 2 };
      return entry;
    });
    const result = optimizeLineup({ players: roster, slots: SLOTS });
    const move = result.moves.find((item) => item.start.name === "RB Three");
    expect(move).toBeDefined();
    expect(move?.reason).toContain("ranks higher on Chen");
  });

  it("never starts players parked in the IR slot and warns on unfillable slots", () => {
    const roster = fullRoster()
      .filter((entry) => entry.name !== "K One")
      .map((entry) =>
        entry.name === "RB Three" ? { ...entry, selectedSlot: "IR" } : entry,
      );
    const result = optimizeLineup({ players: roster, slots: SLOTS });
    const started = result.starters.flatMap((entry) =>
      entry.player ? [entry.player.name] : [],
    );
    expect(started).not.toContain("RB Three");
    expect(
      result.alerts.some((alert) => alert.message.includes("K slot")),
    ).toBe(true);
  });

  it("warns about questionable starters without benching them for worse options", () => {
    const roster = fullRoster().map((entry) =>
      entry.name === "WR One" ? { ...entry, status: "Q" } : entry,
    );
    const result = optimizeLineup({ players: roster, slots: SLOTS });
    const wrStarters = result.starters
      .filter((entry) => entry.slot === "WR")
      .map((entry) => entry.player?.name);
    expect(wrStarters).toContain("WR One");
    expect(
      result.alerts.some(
        (alert) => alert.severity === "warning" && alert.message.includes("questionable"),
      ),
    ).toBe(true);
  });
});
