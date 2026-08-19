import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHEN_SCORING,
  parseChenCsv,
  parseChenScoring,
  scoringFromSource,
} from "@/adapters/chen/boris-chen";

describe("Boris Chen CSV adapter", () => {
  it("preserves position-specific rank and tier", () => {
    const result = parseChenCsv(
      [
        "Player.Name,Position,Team,Tier,Position.Rank,Overall.Rank,Bye,ADP",
        "A Runner,RB,BUF,2,7,18,7,21.5",
      ].join("\n"),
      "fixture",
      "2026-08-01T00:00:00.000Z",
    );

    expect(result.players[0]).toMatchObject({
      name: "A Runner",
      position: "RB",
      tier: 2,
      positionRank: 7,
      overallRank: 18,
      adp: 21.5,
    });
    expect(result.importedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("uses Chen Avg.Rank as ADP when ADP is absent", () => {
    const result = parseChenCsv(
      '"Rank","Player.Name","Tier","Position","Avg.Rank"\n1,"Ja\'Marr Chase","1","WR",1.6',
    );
    expect(result.players[0]).toMatchObject({
      name: "Ja'Marr Chase",
      overallRank: 1,
      tier: 1,
      adp: 1.6,
    });
  });

  it("normalizes DST and reports unusable rows", () => {
    const result = parseChenCsv(
      "Player,Pos,Tier\nPhiladelphia Eagles,D/ST,1\nMissing Position,,3",
    );
    expect(result.players[0].position).toBe("DEF");
    expect(result.warnings).toHaveLength(1);
  });
});

describe("Chen scoring format", () => {
  it("defaults to half-PPR", () => {
    expect(DEFAULT_CHEN_SCORING).toBe("half-ppr");
    expect(parseChenScoring(null)).toBe("half-ppr");
    expect(parseChenScoring("nope")).toBe("half-ppr");
    expect(scoringFromSource("Built-in mock data")).toBe("half-ppr");
  });

  it("reads the format from the board source label", () => {
    expect(scoringFromSource("Boris Chen · 0.5 PPR")).toBe("half-ppr");
    expect(scoringFromSource("Boris Chen · PPR")).toBe("ppr");
    expect(scoringFromSource("Boris Chen · Standard")).toBe("standard");
    expect(scoringFromSource("Boris Chen PPR")).toBe("ppr");
  });

  it("reads the format from Chen CSV URLs", () => {
    expect(scoringFromSource("weekly-ALL-HALF-PPR.csv")).toBe("half-ppr");
    expect(scoringFromSource("weekly-ALL-PPR.csv")).toBe("ppr");
    expect(scoringFromSource("weekly-ALL.csv")).toBe("standard");
  });

  it("accepts explicit scoring query values", () => {
    expect(parseChenScoring("ppr")).toBe("ppr");
    expect(parseChenScoring("standard")).toBe("standard");
    expect(parseChenScoring("half-ppr")).toBe("half-ppr");
  });
});
