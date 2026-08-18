import { prisma } from "@/persistence/prisma";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  makeManualPick,
  undoLastPick,
  type DraftState,
  type Pick,
  type Player,
  type StrategyWeights,
} from "@/domain";
import { MOCK_PLAYERS } from "@/fixtures/mock-players";
import type { User } from "@prisma/client";

export const LEAGUE_DRAFT_ID = "full-contact-2026";

export interface SharedDraft {
  readonly id: string;
  readonly leagueKey: string | null;
  readonly mode: "mock" | "live";
  readonly teamCount: number;
  readonly rounds: number;
  readonly picks: readonly Pick[];
  readonly players: readonly Player[];
  readonly importedAt: string;
  readonly source: string;
  readonly updatedAt: string;
}

export interface MemberSeat {
  readonly id: string;
  readonly displayName: string;
  readonly draftSlot: number | null;
  readonly teamName: string | null;
  readonly role: string;
  readonly status: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getOrCreateLeagueDraft(): Promise<SharedDraft> {
  const existing = await prisma.leagueDraft.findUnique({
    where: { id: LEAGUE_DRAFT_ID },
  });
  if (existing && existing.playersJson !== "[]") {
    return toShared(existing);
  }
  const created = await prisma.leagueDraft.upsert({
    where: { id: LEAGUE_DRAFT_ID },
    create: {
      id: LEAGUE_DRAFT_ID,
      playersJson: JSON.stringify(MOCK_PLAYERS),
      importedAt: "Synthetic fixture",
      source: "Built-in mock data",
    },
    update:
      existing && existing.playersJson === "[]"
        ? { playersJson: JSON.stringify(MOCK_PLAYERS) }
        : {},
  });
  return toShared(created);
}

function toShared(row: {
  id: string;
  leagueKey: string | null;
  mode: string;
  teamCount: number;
  rounds: number;
  picksJson: string;
  playersJson: string;
  importedAt: string;
  source: string;
  updatedAt: Date;
}): SharedDraft {
  return {
    id: row.id,
    leagueKey: row.leagueKey,
    mode: row.mode === "live" ? "live" : "mock",
    teamCount: row.teamCount,
    rounds: row.rounds,
    picks: parseJson<Pick[]>(row.picksJson, []),
    players: parseJson<Player[]>(row.playersJson, [...MOCK_PLAYERS]),
    importedAt: row.importedAt,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function draftStateFor(shared: SharedDraft, userSlot: number): DraftState {
  return {
    teamCount: shared.teamCount,
    rounds: shared.rounds,
    userSlot,
    picks: shared.picks,
  };
}

export async function listMemberSeats(): Promise<MemberSeat[]> {
  const users = await prisma.user.findMany({
    where: { status: { in: ["active", "pending"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      displayName: true,
      draftSlot: true,
      teamName: true,
      role: true,
      status: true,
    },
  });
  return users;
}

export async function saveSharedDraft(input: {
  readonly mode?: "mock" | "live";
  readonly leagueKey?: string | null;
  readonly picks?: readonly Pick[];
  readonly players?: readonly Player[];
  readonly importedAt?: string;
  readonly source?: string;
  readonly expectedUpdatedAt?: string;
}): Promise<SharedDraft> {
  const current = await getOrCreateLeagueDraft();
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw new ConflictError("Draft was updated by someone else");
  }
  const updated = await prisma.leagueDraft.update({
    where: { id: LEAGUE_DRAFT_ID },
    data: {
      mode: input.mode ?? current.mode,
      leagueKey: input.leagueKey === undefined ? current.leagueKey : input.leagueKey,
      picksJson: JSON.stringify(input.picks ?? current.picks),
      playersJson: JSON.stringify(input.players ?? current.players),
      importedAt: input.importedAt ?? current.importedAt,
      source: input.source ?? current.source,
    },
  });
  return toShared(updated);
}

export async function appendSharedPick(
  playerId: string,
  options: { readonly madeAt?: string } = {},
): Promise<SharedDraft> {
  const current = await getOrCreateLeagueDraft();
  const player = current.players.find((item) => item.id === playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);
  const next = makeManualPick(draftStateFor(current, 1), player, {
    madeAt: options.madeAt ?? new Date().toISOString(),
  });
  return saveSharedDraft({ picks: next.picks });
}

export async function savePicks(picks: readonly Pick[]): Promise<SharedDraft> {
  return saveSharedDraft({ picks });
}

export async function undoSharedPick(): Promise<SharedDraft> {
  const current = await getOrCreateLeagueDraft();
  const next = undoLastPick(draftStateFor(current, 1));
  return saveSharedDraft({ picks: next.picks });
}

export async function resetSharedDraft(
  mode: "mock" | "live",
  leagueKey?: string | null,
): Promise<SharedDraft> {
  return saveSharedDraft({
    mode,
    picks: [],
    ...(leagueKey === undefined ? {} : { leagueKey }),
  });
}

export async function replacePlayers(
  players: readonly Player[],
  source: string,
  importedAt: string,
): Promise<SharedDraft> {
  return saveSharedDraft({
    players,
    source,
    importedAt,
    picks: [],
    mode: "mock",
  });
}

export function userPrefs(user: User): {
  draftSlot: number;
  teamName: string;
  pins: string[];
  avoids: string[];
  weights: StrategyWeights;
  darkMode: boolean;
} {
  const weights = user.weightsJson
    ? { ...DEFAULT_STRATEGY_WEIGHTS, ...parseJson<Partial<StrategyWeights>>(user.weightsJson, {}) }
    : DEFAULT_STRATEGY_WEIGHTS;
  return {
    draftSlot: user.draftSlot && user.draftSlot >= 1 && user.draftSlot <= 12 ? user.draftSlot : 1,
    teamName: user.teamName?.trim() || (user.role === "admin" ? "Cobra Kai" : user.displayName),
    pins: parseJson<string[]>(user.pinsJson, []),
    avoids: parseJson<string[]>(user.avoidsJson, []),
    weights,
    darkMode: user.darkMode,
  };
}

export class ConflictError extends Error {}
