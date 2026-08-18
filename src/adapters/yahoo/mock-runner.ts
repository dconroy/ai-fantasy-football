import type { YahooDraftResult } from "./yahoo-api";

export interface MockPlayerSeed {
  readonly id: string;
  readonly name: string;
  readonly position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  readonly team: string;
  readonly chenRank?: number;
  readonly adp?: number;
}

export interface MockDraftConfig {
  readonly leagueKey: string;
  readonly teamCount: number;
  readonly rounds: number;
  readonly intervalMs: number;
  readonly startedAtIso: string;
  readonly players: readonly MockPlayerSeed[];
  /** Draft slots that pause for a human to confirm. Robots fill the rest. */
  readonly humanSlots?: readonly number[];
  /** Confirmed player ids per human slot, in the order that slot picked them. */
  readonly picksBySlot?: Readonly<Record<number, readonly string[]>>;
  /** @deprecated single-seat legacy field; superseded by humanSlots. */
  readonly userSlot?: number;
  /** @deprecated single-seat legacy field; superseded by picksBySlot. */
  readonly userPicks?: readonly string[];
}

interface NormalizedSeats {
  readonly humanSlots: Set<number>;
  readonly picksBySlot: Record<number, readonly string[]>;
}

/**
 * Accepts either the multi-seat shape (`humanSlots` + `picksBySlot`) or the
 * legacy single-seat shape (`userSlot` + `userPicks`) and returns a uniform
 * view the rest of the module works against.
 */
function normalizeSeats(config: MockDraftConfig): NormalizedSeats {
  if (config.humanSlots && config.humanSlots.length > 0) {
    const picksBySlot: Record<number, readonly string[]> = {};
    for (const slot of config.humanSlots) {
      picksBySlot[slot] = config.picksBySlot?.[slot] ?? [];
    }
    return { humanSlots: new Set(config.humanSlots), picksBySlot };
  }
  const slot = config.userSlot ?? 1;
  return {
    humanSlots: new Set([slot]),
    picksBySlot: { [slot]: config.userPicks ?? [] },
  };
}

/** Total picks confirmed by all human seats combined. */
export function humanPickCount(config: MockDraftConfig): number {
  const { humanSlots, picksBySlot } = normalizeSeats(config);
  let total = 0;
  for (const slot of humanSlots) total += (picksBySlot[slot] ?? []).length;
  return total;
}

const MAX_PER_POSITION: Record<MockPlayerSeed["position"], number> = {
  QB: 3,
  RB: 7,
  WR: 7,
  TE: 3,
  K: 2,
  DEF: 2,
};

/** Snake-order slot for a 1-indexed overall pick. */
export function slotForOverall(overall: number, teamCount: number): number {
  const round = Math.ceil(overall / teamCount);
  const positionInRound = ((overall - 1) % teamCount) + 1;
  return round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1;
}

/**
 * Deterministic BPA drafter with soft per-position caps.
 * Stops (does not invent a pick) when it reaches a human slot that has not yet
 * confirmed its next pick. Robots fill every non-human slot.
 */
export function projectedDraftOrder(config: MockDraftConfig): MockPlayerSeed[] {
  const { humanSlots, picksBySlot } = normalizeSeats(config);
  const byId = new Map(config.players.map((player) => [player.id, player]));
  const sortable = [...config.players].sort((a, b) => {
    const rank = (a.chenRank ?? 9999) - (b.chenRank ?? 9999);
    if (rank !== 0) return rank;
    return (a.adp ?? 9999) - (b.adp ?? 9999);
  });
  const totalPicks = Math.min(
    sortable.length,
    config.teamCount * config.rounds,
  );
  const rosters: Array<Record<MockPlayerSeed["position"], number>> = Array.from(
    { length: config.teamCount },
    () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 }),
  );
  const remaining = new Set(sortable.map((player) => player.id));
  for (const slot of humanSlots) {
    for (const id of picksBySlot[slot] ?? []) remaining.delete(id);
  }

  const picks: MockPlayerSeed[] = [];
  const consumed: Record<number, number> = {};

  for (let overall = 1; overall <= totalPicks; overall += 1) {
    const slot = slotForOverall(overall, config.teamCount);
    const round = Math.ceil(overall / config.teamCount);

    if (humanSlots.has(slot)) {
      const slotPicks = picksBySlot[slot] ?? [];
      const index = consumed[slot] ?? 0;
      const userId = slotPicks[index];
      if (!userId) break;
      const player = byId.get(userId);
      if (!player) break;
      consumed[slot] = index + 1;
      remaining.delete(player.id);
      rosters[slot - 1][player.position] += 1;
      picks.push(player);
      continue;
    }

    const roster = rosters[slot - 1];
    const candidate = sortable.find((player) => {
      if (!remaining.has(player.id)) return false;
      if (roster[player.position] >= MAX_PER_POSITION[player.position]) return false;
      if ((player.position === "K" || player.position === "DEF") && round < 12) {
        return false;
      }
      return true;
    });
    const choice = candidate ?? sortable.find((player) => remaining.has(player.id));
    if (!choice) break;
    remaining.delete(choice.id);
    roster[choice.position] += 1;
    picks.push(choice);
  }
  return picks;
}

/** Number of picks that should have been made by `now` based on the schedule. */
export function elapsedPickCount(
  config: MockDraftConfig,
  now: number = Date.now(),
): number {
  const started = Date.parse(config.startedAtIso);
  if (!Number.isFinite(started)) return 0;
  const delta = Math.max(0, now - started);
  return Math.floor(delta / config.intervalMs);
}

/**
 * The human slot the draft is currently blocked on, or null when a robot pick
 * is due (or the draft is complete). "Blocked" means the projector stopped at a
 * human seat AND the clock has already reached that pick.
 */
export function waitingSlot(
  config: MockDraftConfig,
  now: number = Date.now(),
): number | null {
  const { humanSlots } = normalizeSeats(config);
  const order = projectedDraftOrder(config);
  if (order.length >= config.teamCount * config.rounds) return null;
  const nextOverall = order.length + 1;
  const slot = slotForOverall(nextOverall, config.teamCount);
  if (!humanSlots.has(slot)) return null;
  return elapsedPickCount(config, now) >= order.length ? slot : null;
}

/**
 * True when the draft is blocked on any human seat right now.
 */
export function isWaitingOnUser(
  config: MockDraftConfig,
  now: number = Date.now(),
): boolean {
  return waitingSlot(config, now) !== null;
}

/**
 * Yahoo-shaped draft results for the mock.
 * Never invents a user-slot pick; clock advancement past a user turn is ignored
 * until that pick is recorded via `userPicks`.
 */
export function mockDraftResults(
  config: MockDraftConfig,
  now: number = Date.now(),
): {
  picks: YahooDraftResult[];
  total: number;
  order: MockPlayerSeed[];
  waitingOnUser: boolean;
  waitingSlot: number | null;
} {
  const order = projectedDraftOrder(config);
  const readyCount = Math.min(order.length, elapsedPickCount(config, now));
  const picks: YahooDraftResult[] = order.slice(0, readyCount).map((player, index) => {
    const overall = index + 1;
    return {
      pick: overall,
      round: Math.ceil(overall / config.teamCount),
      teamKey: `mock.t.${slotForOverall(overall, config.teamCount)}`,
      playerKey: `mock.p.${player.id}`,
    };
  });
  const blockedOn = waitingSlot(config, now);
  return {
    picks,
    total: config.teamCount * config.rounds,
    order,
    waitingOnUser: blockedOn !== null,
    waitingSlot: blockedOn,
  };
}

/**
 * Append a confirmed pick for whichever human seat is currently on the clock
 * and rewind the clock so the next robot pick lands one interval from `now`.
 * When `expectedSlot` is provided it must match the on-clock seat — this guards
 * against a stale client confirming out of turn.
 */
export function recordUserPick(
  config: MockDraftConfig,
  playerId: string,
  now: number = Date.now(),
  expectedSlot?: number,
): MockDraftConfig {
  const slot = waitingSlot(config, now);
  if (slot === null) {
    throw new Error("Mock draft is not waiting on a human pick");
  }
  if (expectedSlot !== undefined && expectedSlot !== slot) {
    throw new Error(
      `Mock draft is on the clock for slot ${slot}, not slot ${expectedSlot}`,
    );
  }
  if (projectedDraftOrder(config).some((player) => player.id === playerId)) {
    throw new Error(`Player ${playerId} is already drafted`);
  }
  if (!config.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }

  const { humanSlots, picksBySlot } = normalizeSeats(config);
  const picksBeforeConfirm = projectedDraftOrder(config).length;
  const nextPicksBySlot: Record<number, readonly string[]> = {};
  for (const seat of humanSlots) nextPicksBySlot[seat] = picksBySlot[seat] ?? [];
  nextPicksBySlot[slot] = [...(nextPicksBySlot[slot] ?? []), playerId];

  // Align the clock so only picks through the just-confirmed selection are ready
  // now; the next robot pick appears after one more interval.
  const doneCount = picksBeforeConfirm + 1;
  const startedAtIso = new Date(
    now - doneCount * config.intervalMs,
  ).toISOString();
  return {
    ...config,
    humanSlots: [...humanSlots],
    picksBySlot: nextPicksBySlot,
    userSlot: undefined,
    userPicks: undefined,
    startedAtIso,
  };
}
