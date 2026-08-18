import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import { normalizePlayerName, normalizeTeam } from "@/domain/identity";
import { getValidYahooAccessToken } from "./oauth";
import { YahooApi } from "./yahoo-api";

/**
 * Boris Chen's tier CSV has no team or bye-week columns, so the draft board
 * shows byes as "—". This module backfills that metadata from Yahoo, whose
 * player resource carries `editorial_team_abbr` and `bye_weeks`. Bye weeks are
 * an NFL-wide, season-stable constant, so any league key resolves them and the
 * result is cached for a long while.
 */

const CACHE_SOURCE = "yahoo-player-meta";
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // team/bye barely change across a season
const MAX_PLAYERS = 300; // 12 pages of 25 — covers every draftable player

export interface PlayerMeta {
  readonly name: string;
  readonly position: string;
  readonly team: string;
  readonly teamFull?: string;
  readonly byeWeek?: number;
  readonly imageUrl?: string;
  readonly percentOwned?: number;
  readonly playerKey?: string;
  readonly status?: string;
}

export interface PlayerMetaHit {
  readonly team: string;
  readonly teamFull?: string;
  readonly byeWeek?: number;
  readonly imageUrl?: string;
  readonly percentOwned?: number;
  readonly playerKey?: string;
  readonly status?: string;
}

export interface PlayerMetaIndex {
  /** name+position → metadata, for matching skill players and kickers. */
  readonly players: Map<string, PlayerMetaHit>;
  /**
   * Canonical team abbreviation (e.g. "PHI") → bye week. Derived from every
   * player's team, so it resolves byes for defenses that never match by name.
   */
  readonly teamBye: Map<string, number>;
}

/** Key a player by normalized name + position for cross-source matching. */
export function playerMetaKey(name: string, position: string): string {
  return `${normalizePlayerName(name)}|${position.toUpperCase()}`;
}

async function readCached(): Promise<{
  records: PlayerMeta[];
  fetchedAt: Date;
} | null> {
  try {
    const row = await prisma.dataImport.findFirst({
      where: { source: CACHE_SOURCE },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true, fetchedAt: true },
    });
    if (!row) return null;
    return {
      records: JSON.parse(row.payload) as PlayerMeta[],
      fetchedAt: row.fetchedAt,
    };
  } catch {
    return null;
  }
}

async function resolveLeagueKey(api: YahooApi): Promise<string | null> {
  const envKey = process.env.YAHOO_LEAGUE_KEY?.trim();
  if (envKey) return envKey;
  try {
    const leagues = await api.getUserNflLeagues();
    const newest = [...leagues].sort(
      (a, b) => (b.season ?? 0) - (a.season ?? 0),
    )[0];
    return newest?.leagueKey ?? null;
  } catch {
    return null;
  }
}

/** Fetch team/bye for the top players from Yahoo and cache them. */
export async function refreshYahooPlayerMeta(): Promise<PlayerMeta[] | null> {
  let token: string;
  try {
    token = await getValidYahooAccessToken();
  } catch {
    return null; // Yahoo not connected — nothing we can do.
  }
  const api = new YahooApi(token);
  const leagueKey = await resolveLeagueKey(api);
  if (!leagueKey) return null;

  const records: PlayerMeta[] = [];
  for (let start = 0; start < MAX_PLAYERS; start += 25) {
    let batch;
    try {
      batch = await api.getPlayerMeta(leagueKey, start, 25);
    } catch {
      break; // partial data is still useful; keep what we gathered
    }
    for (const player of batch) {
      records.push({
        name: player.name,
        position: player.position,
        team: player.team,
        teamFull: player.teamFull,
        byeWeek: player.byeWeek,
        imageUrl: player.imageUrl,
        percentOwned: player.percentOwned,
        playerKey: player.playerKey,
        status: player.status,
      });
    }
    if (batch.length < 25) break;
  }
  if (records.length === 0) return null;

  await prisma.dataImport
    .create({
      data: {
        source: CACHE_SOURCE,
        playerCount: records.length,
        checksum: createHash("sha256")
          .update(JSON.stringify(records))
          .digest("hex"),
        payload: JSON.stringify(records),
      },
    })
    .catch(() => undefined);
  return records;
}

/**
 * A `players` lookup (`playerMetaKey` → metadata) plus a `teamBye` lookup
 * (canonical team abbr → bye week). Serves the cache when it is fresh, otherwise
 * refreshes from Yahoo (falling back to a stale cache if the refresh fails).
 * Returns null when no metadata is available at all.
 */
export async function getPlayerMetaIndex(): Promise<PlayerMetaIndex | null> {
  const cached = await readCached();
  const fresh =
    cached && Date.now() - cached.fetchedAt.getTime() < MAX_AGE_MS
      ? cached.records
      : (await refreshYahooPlayerMeta()) ?? cached?.records ?? null;
  if (!fresh) return null;

  const players = new Map<string, PlayerMetaHit>();
  const teamBye = new Map<string, number>();
  for (const record of fresh) {
    if (!record.name) continue;
    if (record.byeWeek !== undefined && record.team) {
      const abbr = normalizeTeam(record.team) ?? record.team.toUpperCase();
      if (!teamBye.has(abbr)) teamBye.set(abbr, record.byeWeek);
    }
    const key = playerMetaKey(record.name, record.position);
    const existing = players.get(key);
    // Prefer an entry that actually carries a bye week.
    if (!existing || (existing.byeWeek === undefined && record.byeWeek !== undefined)) {
      players.set(key, {
        team: record.team,
        teamFull: record.teamFull,
        byeWeek: record.byeWeek,
        imageUrl: record.imageUrl,
        percentOwned: record.percentOwned,
        playerKey: record.playerKey,
        status: record.status,
      });
    }
  }
  return { players, teamBye };
}
