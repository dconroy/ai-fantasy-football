import { describe, expect, it } from "vitest";

import { chipsForPosition } from "../../src/adapters/sleeper/player-brief";

describe("chipsForPosition", () => {
  it("builds an RB 2025 line from Sleeper stats", () => {
    const chips = chipsForPosition("RB", {
      gp: 17,
      rush_yd: 1223,
      rush_td: 13,
      rec: 77,
      rec_yd: 616,
      rec_td: 5,
      pts_ppr: 366.9,
    });
    expect(chips.map((chip) => chip.label)).toEqual([
      "GP",
      "Rush yd",
      "Rush TD",
      "Rec",
      "Rec yd",
      "PPR",
    ]);
    expect(chips[1]?.value).toBe("1223");
    expect(chips[5]?.value).toBe("366.9");
  });

  it("returns an empty list when Sleeper has no row", () => {
    expect(chipsForPosition("WR", undefined)).toEqual([]);
  });
});
