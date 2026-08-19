import { DEFAULT_ROSTER_LIMITS } from "../config/strategy";
import type {
  Pick,
  Player,
  Position,
  RosterSlot,
  RosterSlotLimits,
} from "./types";

const FLEX_POSITIONS: readonly Position[] = ["RB", "WR", "TE"];

export function rosterPicks(picks: readonly Pick[], slot: number): readonly Pick[] {
  return picks.filter((pick) => pick.slot === slot);
}

export function rosterSlotCounts(picks: readonly Pick[]): Readonly<Record<RosterSlot, number>> {
  const counts: Record<RosterSlot, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    K: 0,
    DEF: 0,
    BENCH: 0,
    IR: 0,
  };
  for (const pick of picks) counts[pick.rosterSlot] += 1;
  return counts;
}

export interface AssignmentOptions {
  readonly limits?: RosterSlotLimits;
  /** IR is only used for players explicitly marked IR. */
  readonly allowIr?: boolean;
  /**
   * When the constructed roster is already full, still park the player on
   * BENCH. Draft recording needs this: robots can stack 7 WRs / 3 QBs, which
   * overflows the 1+2+2+1+1+1+1+6 shape before round 15.
   */
  readonly overflowBench?: boolean;
}

export function assignRosterSlot(
  player: Player,
  picks: readonly Pick[],
  options: AssignmentOptions = {},
): RosterSlot | null {
  const limits = options.limits ?? DEFAULT_ROSTER_LIMITS;
  const counts = rosterSlotCounts(picks);

  if (
    options.allowIr !== false &&
    player.injuryStatus === "IR" &&
    counts.IR < limits.IR
  ) {
    return "IR";
  }

  const directSlot = player.position;
  if (counts[directSlot] < limits[directSlot]) return directSlot;
  if (FLEX_POSITIONS.includes(player.position) && counts.FLEX < limits.FLEX) return "FLEX";
  if (counts.BENCH < limits.BENCH) return "BENCH";
  if (options.overflowBench) return "BENCH";
  return null;
}

export function isRosterFull(
  picks: readonly Pick[],
  limits: RosterSlotLimits = DEFAULT_ROSTER_LIMITS,
): boolean {
  const counts = rosterSlotCounts(picks);
  return (
    counts.QB +
      counts.RB +
      counts.WR +
      counts.TE +
      counts.FLEX +
      counts.K +
      counts.DEF +
      counts.BENCH >=
    limits.QB +
      limits.RB +
      limits.WR +
      limits.TE +
      limits.FLEX +
      limits.K +
      limits.DEF +
      limits.BENCH
  );
}

export function openStarterSlots(
  picks: readonly Pick[],
  limits: RosterSlotLimits = DEFAULT_ROSTER_LIMITS,
): readonly RosterSlot[] {
  const counts = rosterSlotCounts(picks);
  const slots: RosterSlot[] = [];
  const starterSlots: readonly Exclude<RosterSlot, "BENCH" | "IR">[] = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "K",
    "DEF",
  ];
  for (const slot of starterSlots) {
    for (let index = counts[slot]; index < limits[slot]; index += 1) slots.push(slot);
  }
  return slots;
}
