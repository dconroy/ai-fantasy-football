import { assignRosterSlot, rosterPicks } from "./roster";
import { selectionForOverall } from "./snake";
import type { DraftState, Pick, Player, RosterSlot } from "./types";

export function createDraftState(
  userSlot: number,
  options: { readonly teamCount?: number; readonly rounds?: number } = {},
): DraftState {
  const teamCount = options.teamCount ?? 12;
  const rounds = options.rounds ?? 15;
  if (!Number.isInteger(userSlot) || userSlot < 1 || userSlot > teamCount) {
    throw new RangeError(`userSlot must be between 1 and ${teamCount}`);
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new RangeError("rounds must be a positive integer");
  }
  return { teamCount, rounds, userSlot, picks: [] };
}

export interface MakePickOptions {
  readonly rosterSlot?: RosterSlot;
  readonly madeAt?: string;
  readonly allowIr?: boolean;
}

/**
 * Adds the next pick without mutating the state or any existing array.
 * Opponent and user picks use the same path so imported/manual drafts stay deterministic.
 */
export function makeManualPick(
  state: DraftState,
  player: Player,
  options: MakePickOptions = {},
): DraftState {
  const overall = state.picks.length + 1;
  if (overall > state.teamCount * state.rounds) {
    throw new Error("Draft is complete");
  }
  if (state.picks.some((pick) => pick.player.id === player.id)) {
    throw new Error(`Player ${player.id} has already been drafted`);
  }

  const selection = selectionForOverall(overall, state.teamCount);
  const teamRoster = rosterPicks(state.picks, selection.slot);
  const rosterSlot =
    options.rosterSlot ??
    assignRosterSlot(player, teamRoster, {
      allowIr: options.allowIr,
      overflowBench: true,
    });
  if (!rosterSlot) throw new Error(`Roster for slot ${selection.slot} is full`);

  const pick: Pick = {
    ...selection,
    player,
    rosterSlot,
    ...(options.madeAt ? { madeAt: options.madeAt } : {}),
  };
  return { ...state, picks: [...state.picks, pick] };
}

export function undoLastPick(state: DraftState): DraftState {
  if (state.picks.length === 0) return state;
  return { ...state, picks: state.picks.slice(0, -1) };
}

export function availablePlayers(
  state: DraftState,
  players: readonly Player[],
): readonly Player[] {
  const drafted = new Set(state.picks.map((pick) => pick.player.id));
  return players.filter((player) => !drafted.has(player.id));
}

export function opponentPick(state: DraftState, players: readonly Player[]) {
  const candidates = [...availablePlayers(state, players)].sort(
    (a, b) =>
      (a.chenRank ?? Number.MAX_SAFE_INTEGER) -
      (b.chenRank ?? Number.MAX_SAFE_INTEGER),
  );
  for (const player of candidates) {
    try {
      return makeManualPick(state, player);
    } catch {
      // Try the next roster-eligible player.
    }
  }
  return state;
}

export function simulateToUserTurn(state: DraftState, players: readonly Player[]) {
  let next = state;
  while (
    next.picks.length < next.teamCount * next.rounds &&
    selectionForOverall(next.picks.length + 1, next.teamCount).slot !== next.userSlot
  ) {
    const advanced = opponentPick(next, players);
    if (advanced === next) break;
    next = advanced;
  }
  return next;
}
