import { describe, expect, it } from "vitest";
import {
  isWaitingOnUser,
  mockDraftResults,
  projectedDraftOrder,
  recordUserPick,
  slotForOverall,
  type MockDraftConfig,
  type MockPlayerSeed,
} from "@/adapters/yahoo/mock-runner";

function seeds(count: number): MockPlayerSeed[] {
  const positions = ["RB", "WR", "QB", "TE", "K", "DEF"] as const;
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    position: positions[index % positions.length],
    team: "KC",
    chenRank: index + 1,
  }));
}

function config(overrides: Partial<MockDraftConfig> = {}): MockDraftConfig {
  return {
    leagueKey: "mock.test",
    teamCount: 12,
    rounds: 15,
    userSlot: 5,
    intervalMs: 1000,
    startedAtIso: new Date(0).toISOString(),
    players: seeds(200),
    userPicks: [],
    ...overrides,
  };
}

describe("mock-runner", () => {
  it("maps snake slots correctly", () => {
    expect(slotForOverall(1, 12)).toBe(1);
    expect(slotForOverall(5, 12)).toBe(5);
    expect(slotForOverall(12, 12)).toBe(12);
    expect(slotForOverall(13, 12)).toBe(12);
    expect(slotForOverall(17, 12)).toBe(8);
  });

  it("stops projecting at the user slot until a pick is recorded", () => {
    const base = config();
    const before = projectedDraftOrder(base);
    expect(before).toHaveLength(4);
    expect(isWaitingOnUser(base)).toBe(true);

    const after = recordUserPick(base, "p5", 10_000);
    expect(projectedDraftOrder(after).length).toBeGreaterThanOrEqual(5);
    expect(after.userPicks).toEqual(["p5"]);
  });

  it("does not invent a user pick when the clock runs past the turn", () => {
    const base = config({ startedAtIso: new Date(0).toISOString() });
    const farFuture = 60_000;
    const { picks, waitingOnUser } = mockDraftResults(base, farFuture);
    expect(picks).toHaveLength(4);
    expect(waitingOnUser).toBe(true);
  });

  it("resumes opponent picks after confirm and clock rewind", () => {
    const base = config();
    const confirmed = recordUserPick(base, "p5", 20_000);
    const rightAfter = mockDraftResults(confirmed, 20_000);
    expect(rightAfter.picks).toHaveLength(5);
    expect(rightAfter.waitingOnUser).toBe(false);

    const nextTick = mockDraftResults(
      confirmed,
      20_000 + confirmed.intervalMs,
    );
    expect(nextTick.picks.length).toBeGreaterThanOrEqual(6);
  });
});
