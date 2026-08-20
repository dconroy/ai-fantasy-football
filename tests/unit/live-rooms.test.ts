import { describe, expect, it } from "vitest";

import { summarizeLiveRooms } from "../../src/app/live-rooms";

const room = (
  overrides: Partial<Parameters<typeof summarizeLiveRooms>[0][number]> & {
    complete: boolean;
    openSeats: number;
    activeSeats: number;
  },
) => overrides;

describe("live room banner copy", () => {
  it("does not say no drafts when people are still drafting in full rooms", () => {
    const summary = summarizeLiveRooms([
      room({ complete: false, openSeats: 0, activeSeats: 3 }),
    ]);
    expect(summary.headline).toBe("1 live draft · rooms full");
    expect(summary.activePlayers).toBe(3);
    expect(summary.emptyPrompt).toMatch(/full/i);
    expect(summary.cta).toBe("Create a demo draft");
  });

  it("ignores finished rooms so leftover seats are not drafting now", () => {
    const summary = summarizeLiveRooms([
      room({ complete: true, openSeats: 0, activeSeats: 3 }),
    ]);
    expect(summary.headline).toBe("No live drafts right now");
    expect(summary.activePlayers).toBe(0);
    expect(summary.emptyPrompt).toMatch(/first in the dojo/i);
  });

  it("lists joinable rooms when seats are open", () => {
    const summary = summarizeLiveRooms([
      room({ complete: false, openSeats: 4, activeSeats: 2 }),
    ]);
    expect(summary.headline).toBe("1 live draft · 4 open seats");
    expect(summary.joinable).toHaveLength(1);
    expect(summary.cta).toBe("Browse live drafts");
  });
});
