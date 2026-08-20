import { describe, expect, it } from "vitest";

import {
  chipsForPosition,
  seasonRowsForPosition,
} from "../../src/adapters/sleeper/player-brief";

describe("chipsForPosition", () => {
  it("builds an RB line from Sleeper stats", () => {
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

describe("seasonRowsForPosition", () => {
  it("keeps years that have stats and drops empty ones", () => {
    const rows = seasonRowsForPosition("WR", [
      {
        year: 2025,
        raw: { gp: 16, rec: 125, rec_yd: 1412, rec_td: 8, rush_yd: 14, pts_ppr: 313.6 },
      },
      { year: 2024, raw: { gp: 17, rec: 127, rec_yd: 1708, rec_td: 17, pts_ppr: 403.0 } },
      { year: 2023, raw: undefined },
      { year: 2022, raw: { gp: 12, rec: 87, rec_yd: 1046, rec_td: 9, pts_ppr: 246.6 } },
    ]);
    expect(rows.map((row) => row.year)).toEqual([2025, 2024, 2022]);
    expect(rows[0]?.stats[2]?.value).toBe("1412");
  });
});
