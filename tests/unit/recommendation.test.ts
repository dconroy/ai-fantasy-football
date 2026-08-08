import { describe, expect, it } from "vitest";

import { AUTOMATIC_BEHAVIOR, DEFAULT_STRATEGY_WEIGHTS } from "../../src/config";
import {
  createDraftState,
  makeManualPick,
  recommendPlayers,
  type DraftState,
  type Player,
} from "../../src/domain";

const candidate = (
  id: string,
  position: Player["position"],
  chenRank: number,
  chenTier: number,
  overrides: Partial<Player> = {},
): Player => ({
  id,
  name: id,
  position,
  team: "BUF",
  chenRank,
  chenTier,
  adp: chenRank,
  byeWeek: 7,
  ...overrides,
});

function stateAfterFirstRound(): DraftState {
  let state = createDraftState(1);
  state = makeManualPick(
    state,
    candidate("starter-qb", "QB", 10, 1, { team: "KC", byeWeek: 10 }),
  );
  for (let overall = 2; overall <= 12; overall += 1) {
    state = makeManualPick(
      state,
      candidate(`opponent-${overall}`, "WR", 100 + overall, 8, {
        team: `T${overall}`,
      }),
    );
  }
  return state;
}

const pool: readonly Player[] = [
  candidate("elite-rb", "RB", 8, 1, {
    estimatedReturnProbability: 0.1,
    team: "SF",
  }),
  candidate("next-rb", "RB", 45, 4, { team: "ATL" }),
  candidate("top-wr", "WR", 12, 2, {
    estimatedReturnProbability: 0.2,
    team: "MIA",
  }),
  candidate("solid-wr", "WR", 25, 3, { team: "DAL" }),
  candidate("starting-te", "TE", 30, 3, { team: "DET" }),
  candidate("backup-qb", "QB", 15, 2, { team: "BAL" }),
  candidate("early-k", "K", 60, 1, { team: "PHI" }),
  candidate("early-def", "DEF", 55, 1, { team: "NYJ" }),
];

describe("transparent recommendations", () => {
  it("returns five ranked options with complete factor breakdowns", () => {
    const result = recommendPlayers(stateAfterFirstRound(), pool);
    expect(result.recommendations).toHaveLength(5);
    expect(result.currentOverall).toBe(13);
    expect(result.currentRound).toBe(2);
    expect(result.picksUntilFollowingSelection).toBe(0);
    expect(result.recommendations[0].player.id).toBe("elite-rb");

    const factorNames = result.recommendations[0].factors.map(
      (factor) => factor.factor,
    );
    expect(factorNames).toEqual(Object.keys(DEFAULT_STRATEGY_WEIGHTS));
    expect(result.recommendations[0].explanations.length).toBeGreaterThan(0);
    expect(
      result.recommendations[0].factors.reduce(
        (sum, factor) => sum + factor.contribution,
        0,
      ),
    ).toBeCloseTo(result.recommendations[0].score);
  });

  it("exposes Chen tier cliffs, roster need, FLEX, scarcity, and turn urgency", () => {
    const result = recommendPlayers(stateAfterFirstRound(), pool);
    const elite = result.recommendations.find(
      (recommendation) => recommendation.player.id === "elite-rb",
    );
    expect(elite).toBeDefined();
    expect(elite?.suggestedRosterSlot).toBe("RB");
    expect(
      elite?.factors.find((factor) => factor.factor === "tierCliff")?.value,
    ).toBeGreaterThan(0);
    expect(
      elite?.factors.find((factor) => factor.factor === "positionalNeed")?.value,
    ).toBe(1);
    expect(
      elite?.factors.find((factor) => factor.factor === "flexValue")?.value,
    ).toBe(1);
    expect(
      elite?.factors.find((factor) => factor.factor === "turnUrgency")?.value,
    ).toBeCloseTo(0.9);
  });

  it("penalizes backup QB/TE and excludes early K/DEF recommendations", () => {
    const result = recommendPlayers(stateAfterFirstRound(), pool, { topCount: 8 });
    const byId = new Map(
      result.recommendations.map((recommendation) => [
        recommendation.player.id,
        recommendation,
      ]),
    );
    expect(
      byId
        .get("backup-qb")
        ?.factors.find((factor) => factor.factor === "backupPenalty")?.value,
    ).toBe(-1);
    expect(byId.has("early-k")).toBe(false);
    expect(byId.has("early-def")).toBe(false);
  });

  it("uses optional ADP and return probability while allowing weight overrides", () => {
    const result = recommendPlayers(createDraftState(6), pool, {
      topCount: 8,
      weights: { turnUrgency: 50, adpValue: 25 },
    });
    const elite = result.recommendations.find(
      (recommendation) => recommendation.player.id === "elite-rb",
    );
    expect(
      elite?.factors.find((factor) => factor.factor === "turnUrgency"),
    ).toMatchObject({ value: 0.9, weight: 50, contribution: 45 });
    expect(
      elite?.factors.find((factor) => factor.factor === "adpValue")?.weight,
    ).toBe(25);
  });

  it("applies small bye-week and NFL-team concentration penalties", () => {
    const concentratedState: DraftState = {
      ...createDraftState(1),
      picks: [
        {
          overall: 1,
          round: 1,
          slot: 1,
          rosterSlot: "RB",
          player: candidate("same-1", "RB", 1, 1),
        },
        {
          overall: 2,
          round: 1,
          slot: 1,
          rosterSlot: "WR",
          player: candidate("same-2", "WR", 2, 1),
        },
      ],
    };
    const result = recommendPlayers(
      concentratedState,
      [candidate("same-3", "TE", 20, 2)],
      { topCount: 1 },
    );
    const factors = result.recommendations[0].factors;
    expect(
      factors.find((factor) => factor.factor === "byeConcentration")?.value,
    ).toBeLessThan(0);
    expect(
      factors.find((factor) => factor.factor === "teamConcentration")?.value,
    ).toBeLessThan(0);
  });
});

describe("automatic behavior safety", () => {
  it("is disabled by default", () => {
    expect(AUTOMATIC_BEHAVIOR).toEqual({
      enabled: false,
      autoPick: false,
      autoSync: false,
    });
  });
});
