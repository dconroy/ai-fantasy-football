import { describe, expect, it } from "vitest";

import { AUTOMATIC_BEHAVIOR, DEFAULT_STRATEGY_WEIGHTS } from "../../src/config";
import {
  byeConcentrationValue,
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

  it("excludes avoided player ids from the top recommendations", () => {
    const withoutAvoid = recommendPlayers(createDraftState(1), pool, {
      topCount: 5,
    });
    const avoidedId = withoutAvoid.recommendations[0]?.player.id;
    expect(avoidedId).toBeTruthy();
    const withAvoid = recommendPlayers(createDraftState(1), pool, {
      topCount: 5,
      excludePlayerIds: [avoidedId!],
    });
    expect(
      withAvoid.recommendations.some(
        (recommendation) => recommendation.player.id === avoidedId,
      ),
    ).toBe(false);
    expect(withAvoid.recommendations).toHaveLength(5);
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

  it("applies NFL-team concentration penalties once two teammates are rostered", () => {
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
      factors.find((factor) => factor.factor === "teamConcentration")?.value,
    ).toBeLessThan(0);
    expect(
      factors.find((factor) => factor.factor === "byeConcentration")?.value,
    ).toBe(0);
  });

  it("penalizes a fourth player on the same bye so they are not the top pick", () => {
    const stacked: DraftState = {
      ...createDraftState(1),
      picks: [
        {
          overall: 1,
          round: 1,
          slot: 1,
          rosterSlot: "RB",
          player: candidate("bye-1", "RB", 1, 1, { team: "SF", byeWeek: 6 }),
        },
        {
          overall: 2,
          round: 1,
          slot: 1,
          rosterSlot: "WR",
          player: candidate("bye-2", "WR", 2, 1, { team: "CIN", byeWeek: 6 }),
        },
        {
          overall: 3,
          round: 1,
          slot: 1,
          rosterSlot: "WR",
          player: candidate("bye-3", "WR", 3, 1, { team: "DET", byeWeek: 6 }),
        },
      ],
    };
    const result = recommendPlayers(
      stacked,
      [
        candidate("stacked-star", "RB", 4, 1, { team: "ATL", byeWeek: 6 }),
        candidate("clean-rb", "RB", 18, 2, { team: "KC", byeWeek: 10 }),
      ],
      { topCount: 2 },
    );
    expect(result.recommendations.map((item) => item.player.id)).toEqual([
      "clean-rb",
      "stacked-star",
    ]);
    expect(
      result.recommendations[1].factors.find(
        (factor) => factor.factor === "byeConcentration",
      )?.value,
    ).toBe(-1);
  });

  it("does not penalize a third player on the same bye", () => {
    const stacked: DraftState = {
      ...createDraftState(1),
      picks: [
        {
          overall: 1,
          round: 1,
          slot: 1,
          rosterSlot: "RB",
          player: candidate("bye-1", "RB", 1, 1, { team: "SF", byeWeek: 6 }),
        },
        {
          overall: 2,
          round: 1,
          slot: 1,
          rosterSlot: "WR",
          player: candidate("bye-2", "WR", 2, 1, { team: "CIN", byeWeek: 6 }),
        },
      ],
    };
    const result = recommendPlayers(
      stacked,
      [
        candidate("third-on-bye", "RB", 4, 1, { team: "ATL", byeWeek: 6 }),
        candidate("clean-rb", "RB", 18, 2, { team: "KC", byeWeek: 10 }),
      ],
      { topCount: 2 },
    );
    expect(result.recommendations[0].player.id).toBe("third-on-bye");
    expect(
      result.recommendations[0].factors.find(
        (factor) => factor.factor === "byeConcentration",
      )?.value,
    ).toBe(0);
  });

  it("drops a fifth player on the same bye from Top Five when alternatives exist", () => {
    const stacked: DraftState = {
      ...createDraftState(1),
      picks: [1, 2, 3, 4].map((index) => ({
        overall: index,
        round: 1,
        slot: 1,
        rosterSlot: index <= 2 ? ("RB" as const) : ("WR" as const),
        player: candidate(`bye-${index}`, index <= 2 ? "RB" : "WR", index, 1, {
          team: `T${index}`,
          byeWeek: 6,
        }),
      })),
    };
    const alternatives = Array.from({ length: 5 }, (_, index) =>
      candidate(`alt-${index + 1}`, "TE", 40 + index, 4, {
        team: `A${index}`,
        byeWeek: 11,
      }),
    );
    const stackedStar = candidate("fifth-on-bye", "TE", 5, 1, {
      team: "PHI",
      byeWeek: 6,
    });
    const result = recommendPlayers(stacked, [stackedStar, ...alternatives], {
      topCount: 5,
    });
    expect(result.recommendations).toHaveLength(5);
    expect(
      result.recommendations.some((item) => item.player.id === "fifth-on-bye"),
    ).toBe(false);
  });

  it("still recommends a 4+ bye stack when no other viable players remain", () => {
    const stacked: DraftState = {
      ...createDraftState(1),
      picks: [1, 2, 3, 4].map((index) => ({
        overall: index,
        round: 1,
        slot: 1,
        rosterSlot: index <= 2 ? ("RB" as const) : ("WR" as const),
        player: candidate(`bye-${index}`, index <= 2 ? "RB" : "WR", index, 1, {
          team: `T${index}`,
          byeWeek: 6,
        }),
      })),
    };
    const result = recommendPlayers(
      stacked,
      [candidate("only-left", "TE", 5, 1, { team: "PHI", byeWeek: 6 })],
      { topCount: 5 },
    );
    expect(result.recommendations.map((item) => item.player.id)).toEqual([
      "only-left",
    ]);
  });
});

describe("bye concentration thresholds", () => {
  it("is neutral through two matching byes and max-penalizes at three", () => {
    expect(byeConcentrationValue(0)).toBe(0);
    expect(byeConcentrationValue(1)).toBe(0);
    expect(byeConcentrationValue(2)).toBe(0);
    expect(byeConcentrationValue(3)).toBe(-1);
    expect(byeConcentrationValue(4)).toBe(-1);
  });
});

describe("late-draft recommendations", () => {
  it("still returns five options after the user slot has no remaining pick", () => {
    const leftover = Array.from({ length: 20 }, (_, index) =>
      candidate(`board-${index + 1}`, "WR", 80 + index, 8, {
        team: `X${index}`,
      }),
    );
    let state = createDraftState(5);
    const total = state.teamCount * state.rounds;
    for (let overall = 1; overall <= total; overall += 1) {
      const slot = ((overall - 1) % 12) + 1;
      // Fill the board except leave leftover WRs undrafted by using unique ids.
      state = makeManualPick(
        state,
        candidate(`taken-${overall}`, slot === 5 ? "RB" : "WR", overall, 5, {
          team: `T${overall % 20}`,
        }),
      );
    }
    const result = recommendPlayers(state, leftover);
    expect(result.recommendations).toHaveLength(5);
    expect(result.picksUntilFollowingSelection).toBeNull();
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
