import { prisma } from "@/persistence/prisma";
import type { ChenImport, ChenPlayerRecord, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const SCORING: Record<ChenScoring, string> = {
  "half-ppr": "HALF",
  ppr: "PPR",
  standard: "STD",
};

interface FpPlayer {
  player_name?: string;
  player_team_id?: string;
  player_position_id?: string;
  rank_ecr?: number;
  pos_rank?: string;
  tier?: number;
}

export async function fetchFantasyProsImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const key = process.env.FANTASYPROS_API_KEY?.trim();
  if (!key) return null;
  const cacheSource = `fantasypros-${scoring}`;
  const year = new Date().getUTCFullYear();
  const url = `https://api.fantasypros.com/v2/json/nfl/${year}/consensus-rankings?position=ALL&scoring=${SCORING[scoring]}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "x-api-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "FantasyPros rejected this key for the full rankings API. Public/free keys are limited to 10 players per position and cannot build a complete draft board",
      );
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        error?.message
          ? `FantasyPros: ${error.message}`
          : `FantasyPros returned ${response.status}`,
      );
    }
    const body = (await response.json()) as { players?: FpPlayer[] };
    const players: ChenPlayerRecord[] = [];
    const positionCounts = new Map<string, number>();
    for (const row of body.players ?? []) {
      const name = row.player_name?.trim();
      const rawPos = String(row.player_position_id ?? "").toUpperCase();
      const position = rawPos === "DST" || rawPos === "D/ST" ? "DEF" : rawPos;
      if (!name || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(position)) continue;
      const pos = position as ChenPlayerRecord["position"];
      const nextRank = (positionCounts.get(pos) ?? 0) + 1;
      positionCounts.set(pos, nextRank);
      players.push({
        sourceId: `fp:${pos}:${name.toLowerCase()}`,
        name,
        position: pos,
        team: row.player_team_id?.toUpperCase(),
        tier: row.tier ?? Math.ceil((players.length + 1) / 12),
        positionRank: nextRank,
        overallRank: row.rank_ecr ?? players.length + 1,
        adp: row.rank_ecr,
      });
    }
    if (players.length === 0) return null;
    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `FantasyPros ECR · ${CHEN_SCORING[scoring].label}`,
      warnings: [],
      scoring,
    };
    await prisma.dataImport
      .create({
        data: {
          source: cacheSource,
          playerCount: players.length,
          payload: JSON.stringify(imported),
        },
      })
      .catch(() => undefined);
    return imported;
  } catch (error) {
    const cached = await prisma.dataImport.findFirst({
      where: { source: cacheSource },
      orderBy: { fetchedAt: "desc" },
    });
    if (!cached) throw error;
    return JSON.parse(cached.payload) as ChenImport;
  }
}
