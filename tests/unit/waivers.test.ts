import { describe, expect, it } from "vitest";
import type { LineupPlayer, LineupSlots } from "@/domain/lineup";
import { rankWaiverTargets, type WaiverCandidate } from "@/domain/waivers";

const SLOTS: LineupSlots = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 };

let nextId = 0;
function starter(overrides: Partial<LineupPlayer>): LineupPlayer {
  nextId += 1;
  return {
    id: `r${nextId}`,
    name: `Player ${nextId}`,
    position: "RB",
    team: "KC",
    selectedSlot: "BN",
    ...overrides,
  };
}

/** A healthy, already-optimal roster that fills every starting slot. */
function fullRoster(): LineupPlayer[] {
  return [
    starter({ name: "QB One", position: "QB", selectedSlot: "QB", chenRank: 10 }),
    starter({ name: "RB One", position: "RB", selectedSlot: "RB", chenRank: 5 }),
    starter({ name: "RB Two", position: "RB", selectedSlot: "RB", chenRank: 25 }),
    starter({ name: "RB Three", position: "RB", selectedSlot: "BN", chenRank: 60 }),
    starter({ name: "WR One", position: "WR", selectedSlot: "WR", chenRank: 8 }),
    starter({ name: "WR Two", position: "WR", selectedSlot: "WR", chenRank: 18 }),
    starter({ name: "WR Three", position: "WR", selectedSlot: "WR", chenRank: 30 }),
    starter({ name: "WR Four", position: "WR", selectedSlot: "W/R/T", chenRank: 50 }),
    starter({ name: "TE One", position: "TE", selectedSlot: "TE", chenRank: 40 }),
    starter({ name: "K One", position: "K", selectedSlot: "K", chenRank: 150 }),
    starter({ name: "DEF One", position: "DEF", selectedSlot: "DEF", chenRank: 160 }),
  ];
}

let faId = 0;
function fa(overrides: Partial<WaiverCandidate>): WaiverCandidate {
  faId += 1;
  return {
    id: `fa${faId}`,
    name: `Free Agent ${faId}`,
    position: "WR",
    team: "BUF",
    ...overrides,
  };
}

describe("rankWaiverTargets", () => {
  it("flags a free agent that would beat out a current starter", () => {
    const target = fa({ name: "Upgrade RB", position: "RB", chenRank: 22 });
    const [result] = rankWaiverTargets({
      freeAgents: [target],
      roster: fullRoster(),
      slots: SLOTS,
    });
    expect(result.upgradeOver).not.toBeNull();
    expect(result.upgradeOver?.name).toBe("WR Four");
    expect(result.suggestedDrop?.name).toBe("RB Three");
    const upgrade = result.factors.find((f) => f.factor === "starterUpgrade");
    expect(upgrade?.contribution).toBeGreaterThan(0);
  });

  it("surfaces a positional need when a starter is on bye that week", () => {
    const roster = fullRoster().map((player) =>
      player.name === "TE One" ? { ...player, byeWeek: 9 } : player,
    );
    const target = fa({ name: "Streamer TE", position: "TE", chenRank: 45 });
    const [result] = rankWaiverTargets({
      freeAgents: [target],
      roster,
      slots: SLOTS,
      currentWeek: 9,
    });
    expect(result.fillsNeed).toBe(true);
    expect(result.upgradeOver?.name).toBe("TE One");
    expect(result.reasons[0]).toContain("TE One");
    expect(result.reasons.some((reason) => reason.includes("on bye"))).toBe(true);
  });

  it("distinguishes a hidden gem from a contested add", () => {
    const gem = fa({ name: "Sleeper WR", position: "WR", chenRank: 120, percentOwned: 8 });
    const contested = fa({ name: "Popular WR", position: "WR", chenRank: 60, percentOwned: 70 });
    const results = rankWaiverTargets({
      freeAgents: [gem, contested],
      roster: fullRoster(),
      slots: SLOTS,
    });
    const gemResult = results.find((r) => r.player.id === gem.id)!;
    const contestedResult = results.find((r) => r.player.id === contested.id)!;
    expect(gemResult.isContested).toBe(false);
    expect(gemResult.reasons.some((r) => r.includes("rostered despite"))).toBe(true);
    expect(contestedResult.isContested).toBe(true);
    expect(
      contestedResult.reasons.some((r) => r.includes("grab before a rival")),
    ).toBe(true);
  });

  it("marks players being added around the league as trending", () => {
    const target = fa({ name: "Hot Guy", position: "WR", chenRank: 200 });
    const [result] = rankWaiverTargets({
      freeAgents: [target],
      roster: fullRoster(),
      slots: SLOTS,
      hotAddNames: ["Hot Guy"],
    });
    expect(result.isTrending).toBe(true);
    expect(
      result.reasons.some((r) => r.includes("added around your league")),
    ).toBe(true);
  });

  it("pins watchlisted players to the top regardless of raw value", () => {
    const stud = fa({ name: "Stud WR", position: "WR", chenRank: 15 });
    const watched = fa({ name: "My Guy", position: "WR", chenRank: 250, percentOwned: 1 });
    const results = rankWaiverTargets({
      freeAgents: [stud, watched],
      roster: fullRoster(),
      slots: SLOTS,
      watchlist: [watched.id],
    });
    expect(results[0].player.id).toBe(watched.id);
    expect(results[0].isWatched).toBe(true);
  });

  it("matches a watchlist entry by normalized name", () => {
    const target = fa({ name: "De'Von Achane", position: "RB", chenRank: 300 });
    const [result] = rankWaiverTargets({
      freeAgents: [target],
      roster: fullRoster(),
      slots: SLOTS,
      watchlist: ["devon achane"],
    });
    expect(result.isWatched).toBe(true);
  });
});
