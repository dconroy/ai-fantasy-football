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
import type { ChenImport } from "@/adapters/chen/boris-chen";
import {
  getFreshChenImport,
  readCachedChenImport,
} from "@/adapters/chen/server-cache";
import {
  getPlayerMetaIndex,
  playerMetaKey,
} from "@/adapters/yahoo/player-meta";
import type { User } from "@prisma/client";
import type { Position } from "@/domain";

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
  readonly lastSeenAt: string | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function shapeChenImport(cached: ChenImport | null) {
  if (!cached?.players.length) return null;
  return {
    players: cached.players.map((player) => ({
      id: player.sourceId,
      name: player.name,
      position: player.position as Position,
      team: player.team ?? "FA",
      chenRank: player.overallRank,
      chenTier: player.tier,
      byeWeek: player.byeWeek,
      adp: player.adp,
    })),
    importedAt: cached.importedAt,
    source: cached.source,
  };
}

async function freshPlayersFromChen() {
  return shapeChenImport(await getFreshChenImport());
}

async function playersFromChenCache() {
  return shapeChenImport(await readCachedChenImport());
}

export async function getOrCreateLeagueDraft(): Promise<SharedDraft> {
  const existing = await prisma.leagueDraft.findUnique({
    where: { id: LEAGUE_DRAFT_ID },
  });
  const stillSynthetic =
    !existing ||
    existing.playersJson === "[]" ||
    existing.source === "Built-in mock data";
  if (existing && !stillSynthetic) {
    return toShared(existing);
  }

  const chen = stillSynthetic ? await freshPlayersFromChen() : null;
  const seed = chen ?? {
    players: [...MOCK_PLAYERS],
    importedAt: "Synthetic fixture",
    source: "Built-in mock data",
  };

  const created = await prisma.leagueDraft.upsert({
    where: { id: LEAGUE_DRAFT_ID },
    create: {
      id: LEAGUE_DRAFT_ID,
      playersJson: JSON.stringify(seed.players),
      importedAt: seed.importedAt,
      source: seed.source,
    },
    update: {
      playersJson: JSON.stringify(seed.players),
      importedAt: seed.importedAt,
      source: seed.source,
    },
  });
  return toShared(created);
}

let lastFreshnessCheck = 0;
const FRESHNESS_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes per instance

/**
 * Keeps the shared board on current Boris Chen rankings without anyone pressing
 * a button. Only refreshes while the draft has not started (no picks) so live
 * rankings never shift mid-draft. Throttled so board polling stays cheap.
 */
export async function ensureFreshBoardPlayers(): Promise<void> {
  if (Date.now() - lastFreshnessCheck < FRESHNESS_CHECK_INTERVAL_MS) return;
  lastFreshnessCheck = Date.now();
  try {
    const current = await getOrCreateLeagueDraft();
    if (current.picks.length > 0) return;
    const isSynthetic = current.source === "Built-in mock data";
    const fresh = isSynthetic
      ? await freshPlayersFromChen()
      : shapeChenImport(await getFreshChenImport());
    if (!fresh) return;
    const changed =
      fresh.importedAt !== current.importedAt ||
      fresh.source !== current.source ||
      fresh.players.length !== current.players.length;
    if (!changed) return;
    await saveSharedDraft({
      players: fresh.players,
      source: fresh.source,
      importedAt: fresh.importedAt,
      picks: [],
    });
  } catch {
    // Never let a rankings refresh break loading the board.
  }
}

let lastByeCheck = 0;
const BYE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // per instance

/** Map a Yahoo injury status code to our coarse injuryStatus enum. */
function mapInjuryStatus(status?: string): Player["injuryStatus"] | undefined {
  switch (status?.toUpperCase()) {
    case "Q":
      return "QUESTIONABLE";
    case "D":
      return "DOUBTFUL";
    case "O":
    case "PUP":
    case "SUSP":
    case "NA":
      return "OUT";
    case "IR":
    case "IR-R":
      return "IR";
    default:
      return undefined;
  }
}

/**
 * Backfills team, bye week, headshot, percent-owned, and injury status onto the
 * shared board from Yahoo, since Boris Chen's tier file carries none of it
 * (byes would otherwise always render as "—" and there'd be no player photos).
 * Throttled and best-effort: it no-ops once the pool is enriched, only touches
 * players still missing data, and never breaks board loading.
 */
export async function ensureBoardByes(): Promise<void> {
  if (Date.now() - lastByeCheck < BYE_CHECK_INTERVAL_MS) return;
  lastByeCheck = Date.now();
  try {
    const current = await getOrCreateLeagueDraft();
    // Built-in fixtures already carry byes; nothing to enrich.
    if (current.source === "Built-in mock data") return;
    const needsEnrichment = current.players.some(
      (player) => player.byeWeek === undefined || player.imageUrl === undefined,
    );
    if (!needsEnrichment) return;

    const index = await getPlayerMetaIndex();
    if (!index) return;

    let changed = false;
    const players = current.players.map((player) => {
      const hit = index.get(playerMetaKey(player.name, player.position));
      if (!hit) return player;
      const next: Player = {
        ...player,
        team:
          player.team && player.team !== "FA"
            ? player.team
            : hit.team || player.team,
        teamName: player.teamName ?? hit.teamFull,
        byeWeek: player.byeWeek ?? hit.byeWeek,
        imageUrl: player.imageUrl ?? hit.imageUrl,
        percentOwned: player.percentOwned ?? hit.percentOwned,
        playerKey: player.playerKey ?? hit.playerKey,
        injuryStatus: player.injuryStatus ?? mapInjuryStatus(hit.status),
      };
      if (
        next.team === player.team &&
        next.teamName === player.teamName &&
        next.byeWeek === player.byeWeek &&
        next.imageUrl === player.imageUrl &&
        next.percentOwned === player.percentOwned &&
        next.playerKey === player.playerKey &&
        next.injuryStatus === player.injuryStatus
      ) {
        return player;
      }
      changed = true;
      return next;
    });
    if (!changed) return;
    await saveSharedDraft({ players });
  } catch {
    // Enrichment is a nicety; never let it break loading the board.
  }
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
      lastSeenAt: true,
    },
  });
  return users.map((user) => ({
    ...user,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  }));
}

/** Record activity for presence dots. Throttled to one write per 30s. */
export async function touchLastSeen(user: User): Promise<void> {
  const last = user.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last < 30_000) return;
  await prisma.user
    .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
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
  // Idempotent: if this player is already on the board (e.g. another client
  // synced the pick a beat before this confirm landed), treat it as a no-op so
  // the confirming user never sees a spurious "already drafted" error.
  if (current.picks.some((pick) => pick.player.id === playerId)) {
    return current;
  }
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
