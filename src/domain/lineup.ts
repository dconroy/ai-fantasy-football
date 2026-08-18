/**
 * Weekly start/sit optimizer. Pure domain logic: takes a roster (Yahoo
 * positions + Chen ranks already merged), the league's lineup shape, and the
 * current week, and produces the optimal lineup, concrete swap suggestions,
 * and injury/bye alerts. Advisory only — Yahoo's API is read-only, so moves
 * must be applied manually in the Yahoo app.
 */

export interface LineupSlots {
  readonly QB: number;
  readonly RB: number;
  readonly WR: number;
  readonly TE: number;
  readonly FLEX: number;
  readonly K: number;
  readonly DEF: number;
}

export interface LineupPlayer {
  readonly id: string;
  readonly name: string;
  readonly position: string;
  readonly team: string;
  /** Yahoo selected position: QB, WR, W/R/T, BN, IR… */
  readonly selectedSlot: string;
  readonly chenRank?: number;
  readonly chenTier?: number;
  readonly byeWeek?: number;
  /** Yahoo status abbreviation: Q, D, O, IR, PUP-R, SUSP, NA… */
  readonly status?: string;
}

export interface LineupAlert {
  readonly severity: "critical" | "warning";
  readonly message: string;
}

export interface LineupMove {
  readonly slot: string;
  readonly start: LineupPlayer;
  readonly bench?: LineupPlayer;
  readonly reason: string;
}

export interface OptimalLineup {
  readonly starters: ReadonlyArray<{
    readonly slot: string;
    readonly player: LineupPlayer | null;
  }>;
  readonly bench: readonly LineupPlayer[];
  readonly moves: readonly LineupMove[];
  readonly alerts: readonly LineupAlert[];
}

const UNPLAYABLE_STATUSES = new Set(["O", "IR", "IR-R", "PUP-R", "PUP-P", "NFI-R", "SUSP", "NA"]);
const FLEX_ELIGIBILITY: Readonly<Record<string, readonly string[]>> = {
  "W/R": ["WR", "RB"],
  "W/T": ["WR", "TE"],
  "W/R/T": ["WR", "RB", "TE"],
  "Q/W/R/T": ["QB", "WR", "RB", "TE"],
};
const DEDICATED_SLOTS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

export function lineupSlotsFromYahoo(
  rosterSlots: Readonly<Record<string, number>>,
): LineupSlots {
  let flex = 0;
  for (const label of Object.keys(FLEX_ELIGIBILITY)) {
    flex += rosterSlots[label] ?? 0;
  }
  return {
    QB: rosterSlots.QB ?? 1,
    RB: rosterSlots.RB ?? 2,
    WR: rosterSlots.WR ?? 3,
    TE: rosterSlots.TE ?? 1,
    FLEX: flex || (rosterSlots["W/R/T"] ?? 1),
    K: rosterSlots.K ?? 1,
    DEF: rosterSlots.DEF ?? 1,
  };
}

export function isUnplayable(player: LineupPlayer, currentWeek?: number): boolean {
  if (player.status && UNPLAYABLE_STATUSES.has(player.status.toUpperCase())) {
    return true;
  }
  return currentWeek !== undefined && player.byeWeek === currentWeek;
}

function unavailabilityLabel(player: LineupPlayer, currentWeek?: number): string | null {
  if (currentWeek !== undefined && player.byeWeek === currentWeek) return "on bye";
  const status = player.status?.toUpperCase();
  if (!status) return null;
  if (status === "O") return "ruled OUT";
  if (status.startsWith("IR")) return "on IR";
  if (status.startsWith("PUP")) return "on PUP";
  if (status.startsWith("NFI")) return "on NFI";
  if (status === "SUSP") return "suspended";
  if (status === "NA") return "inactive";
  if (status === "D") return "doubtful";
  if (status === "Q") return "questionable";
  return null;
}

/** Lower is better. Unplayable players sort behind every healthy option. */
function value(player: LineupPlayer, currentWeek?: number): number {
  const base = player.chenRank ?? 400;
  if (isUnplayable(player, currentWeek)) return base + 10_000;
  if (player.status?.toUpperCase() === "D") return base + 30;
  return base;
}

function isCurrentlyStarting(player: LineupPlayer): boolean {
  return player.selectedSlot !== "BN" && player.selectedSlot !== "IR";
}

export function optimizeLineup(input: {
  readonly players: readonly LineupPlayer[];
  readonly slots: LineupSlots;
  readonly currentWeek?: number;
}): OptimalLineup {
  const { slots, currentWeek } = input;
  // Players stashed in Yahoo's IR slot can't start without a roster move.
  const eligible = input.players.filter((player) => player.selectedSlot !== "IR");
  const byValue = (a: LineupPlayer, b: LineupPlayer) =>
    value(a, currentWeek) - value(b, currentWeek);

  const taken = new Set<string>();
  const starters: Array<{ slot: string; player: LineupPlayer | null }> = [];

  for (const slot of DEDICATED_SLOTS) {
    const candidates = eligible
      .filter((player) => player.position === slot && !taken.has(player.id))
      .sort(byValue);
    for (let index = 0; index < slots[slot]; index += 1) {
      const player = candidates[index] ?? null;
      if (player) taken.add(player.id);
      starters.push({ slot, player });
    }
  }

  const flexPositions = new Set(["WR", "RB", "TE"]);
  const flexCandidates = eligible
    .filter((player) => flexPositions.has(player.position) && !taken.has(player.id))
    .sort(byValue);
  for (let index = 0; index < slots.FLEX; index += 1) {
    const player = flexCandidates[index] ?? null;
    if (player) taken.add(player.id);
    starters.push({ slot: "FLEX", player });
  }

  const bench = eligible.filter((player) => !taken.has(player.id)).sort(byValue);

  const optimalIds = new Set(
    starters.flatMap((entry) => (entry.player ? [entry.player.id] : [])),
  );
  const shouldBench = eligible.filter(
    (player) => isCurrentlyStarting(player) && !optimalIds.has(player.id),
  );
  const benchPool = [...shouldBench];

  const moves: LineupMove[] = [];
  for (const entry of starters) {
    const player = entry.player;
    if (!player || isCurrentlyStarting(player)) continue;
    const sameSlotIndex = benchPool.findIndex(
      (candidate) =>
        candidate.position === player.position ||
        (entry.slot === "FLEX" && flexPositions.has(candidate.position)),
    );
    // Lineup changes can cascade across positions (a promoted RB pushes a WR
    // out via FLEX), so fall back to any player who loses their spot.
    const replacementIndex = sameSlotIndex >= 0 ? sameSlotIndex : benchPool.length ? 0 : -1;
    const benchTarget =
      replacementIndex >= 0 ? benchPool.splice(replacementIndex, 1)[0] : undefined;
    const benchIssue = benchTarget
      ? unavailabilityLabel(benchTarget, currentWeek)
      : null;
    const reason = benchTarget
      ? benchIssue
        ? `${benchTarget.name} is ${benchIssue}`
        : `${player.name} ranks higher on Chen (${player.chenRank ?? "—"} vs ${benchTarget.chenRank ?? "—"})`
      : `${entry.slot} slot is open`;
    moves.push({ slot: entry.slot, start: player, bench: benchTarget, reason });
  }

  const alerts: LineupAlert[] = [];
  for (const player of eligible.filter(isCurrentlyStarting)) {
    const label = unavailabilityLabel(player, currentWeek);
    if (!label) continue;
    alerts.push({
      severity: isUnplayable(player, currentWeek) ? "critical" : "warning",
      message: `${player.name} (${player.position}) is ${label} and currently in your starting lineup.`,
    });
  }
  for (const entry of starters) {
    if (!entry.player) {
      alerts.push({
        severity: "warning",
        message: `No available player to fill a ${entry.slot} slot.`,
      });
    }
  }

  return { starters, bench, moves, alerts };
}
