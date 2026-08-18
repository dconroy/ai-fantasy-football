import { describe, expect, it } from "vitest";
import {
  isWaitingOnUser,
  mockDraftResults,
  projectedDraftOrder,
  recordUserPick,
  slotForOverall,
  waitingSlot,
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
    humanSlots: [5],
    intervalMs: 1000,
    startedAtIso: new Date(0).toISOString(),
    players: seeds(200),
    picksBySlot: {},
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
    expect(after.picksBySlot?.[5]).toEqual(["p5"]);
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

  it("normalizes the legacy single-seat shape", () => {
    const legacy = config({
      humanSlots: undefined,
      picksBySlot: undefined,
      userSlot: 3,
      userPicks: [],
    });
    // Robots take picks 1 and 2, then the draft blocks on slot 3.
    expect(projectedDraftOrder(legacy)).toHaveLength(2);
    expect(waitingSlot(legacy)).toBe(3);
  });

  it("pauses at every human seat and fills the rest with robots", () => {
    const base = config({ humanSlots: [1, 3], picksBySlot: {} });
    // Slot 1 is the very first pick, so the draft blocks immediately.
    expect(projectedDraftOrder(base)).toHaveLength(0);
    expect(waitingSlot(base, 10_000)).toBe(1);

    const afterOne = recordUserPick(base, "p1", 10_000, 1);
    expect(afterOne.picksBySlot?.[1]).toEqual(["p1"]);
    // The robot at slot 2 appears one interval after the confirm; only then is
    // slot 3 on the clock.
    expect(projectedDraftOrder(afterOne)).toHaveLength(2);
    expect(waitingSlot(afterOne, 10_000)).toBeNull();
    expect(waitingSlot(afterOne, 10_000 + base.intervalMs)).toBe(3);

    const afterTwo = recordUserPick(afterOne, "p6", 10_000 + base.intervalMs, 3);
    expect(afterTwo.picksBySlot?.[3]).toEqual(["p6"]);
    // Robots continue past slot 3 toward the next human seat.
    expect(projectedDraftOrder(afterTwo).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a confirm from a slot that is not on the clock", () => {
    const base = config({ humanSlots: [1, 3], picksBySlot: {} });
    expect(() => recordUserPick(base, "p1", 10_000, 3)).toThrow(/slot 1/);
  });

  it("rejects confirming an already-drafted player", () => {
    const base = config({ humanSlots: [5], picksBySlot: {} });
    // p1 is the robots' first overall pick; slot 5 cannot re-draft it.
    expect(() => recordUserPick(base, "p1", 10_000)).toThrow(/already drafted/);
  });
});
