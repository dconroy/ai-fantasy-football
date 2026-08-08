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
  readonly userSlot: number;
  readonly intervalMs: number;
  readonly startedAtIso: string;
  readonly players: readonly MockPlayerSeed[];
  /** Player ids the user has confirmed, in draft order. */
  readonly userPicks?: readonly string[];
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
 * Stops (does not invent a pick) when it reaches the user slot and no
 * corresponding entry exists in `userPicks` yet.
 */
export function projectedDraftOrder(config: MockDraftConfig): MockPlayerSeed[] {
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
  for (const id of config.userPicks ?? []) remaining.delete(id);

  const picks: MockPlayerSeed[] = [];
  let userPickIndex = 0;

  for (let overall = 1; overall <= totalPicks; overall += 1) {
    const slot = slotForOverall(overall, config.teamCount);
    const round = Math.ceil(overall / config.teamCount);

    if (slot === config.userSlot) {
      const userId = config.userPicks?.[userPickIndex];
      if (!userId) break;
      const player = byId.get(userId);
      if (!player) break;
      userPickIndex += 1;
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
 * True when the projector has stopped on a missing user pick and the clock has
 * already caught up to that pause (so the draft is blocked on the user now).
 */
export function isWaitingOnUser(
  config: MockDraftConfig,
  now: number = Date.now(),
): boolean {
  const order = projectedDraftOrder(config);
  if (order.length >= config.teamCount * config.rounds) return false;
  const nextOverall = order.length + 1;
  if (slotForOverall(nextOverall, config.teamCount) !== config.userSlot) {
    return false;
  }
  return elapsedPickCount(config, now) >= order.length;
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
  return {
    picks,
    total: config.teamCount * config.rounds,
    order,
    waitingOnUser: isWaitingOnUser(config, now),
  };
}

/**
 * After the user confirms a pick, append it and rewind the clock so the next
 * opponent pick lands after one interval from `now`.
 */
export function recordUserPick(
  config: MockDraftConfig,
  playerId: string,
  now: number = Date.now(),
): MockDraftConfig {
  if ((config.userPicks ?? []).includes(playerId)) {
    throw new Error(`Player ${playerId} already recorded`);
  }
  if (!config.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (!isWaitingOnUser(config)) {
    throw new Error("Mock draft is not waiting on the user");
  }

  const picksBeforeConfirm = projectedDraftOrder(config).length;
  const next: MockDraftConfig = {
    ...config,
    userPicks: [...(config.userPicks ?? []), playerId],
  };
  // Align the clock so only picks through the just-confirmed user selection are
  // ready now; the next opponent pick appears after one more interval.
  const doneCount = picksBeforeConfirm + 1;
  const startedAtIso = new Date(
    now - doneCount * config.intervalMs,
  ).toISOString();
  return { ...next, startedAtIso };
}
