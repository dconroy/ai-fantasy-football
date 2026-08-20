import { describe, expect, it } from "vitest";
import {
  demoSeatKind,
  demoSeatKindLabel,
  rpBotTeamName,
} from "../../src/domain/demo-labels";

describe("demo seat labels", () => {
  it("names RP bots instead of T-slot or Seat N", () => {
    expect(rpBotTeamName(5)).toBe("RP Bot Echo");
    expect(rpBotTeamName(6)).toBe("RP Bot Flux");
    expect(rpBotTeamName(6)).not.toMatch(/T6|Seat 6|Team 6/i);
  });

  it("distinguishes humans from RP bots and open seats", () => {
    expect(demoSeatKind(1, [1], { started: false })).toBe("human");
    expect(demoSeatKind(2, [1], { started: false })).toBe("open");
    expect(demoSeatKind(2, [1], { started: true })).toBe("rp-bot");
    expect(demoSeatKindLabel("human")).toBe("Human");
    expect(demoSeatKindLabel("rp-bot")).toBe("RP Bot");
  });
});
