import { prisma } from "@/persistence/prisma";
import type { ChenImport, ChenPlayerRecord, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const SCORING: Record<ChenScoring, string> = {
  "half-ppr": "HALF",
  ppr: "PPR",
  standard: "STD",
};

/** Current FantasyPros public API. The legacy `/v2/json` host rejects keys with 403. */
const FP_BASE = "https://api.fantasypros.com/public/v2/json";
const FP_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;

export interface FpPlayer {
  player_name?: string;
  player_team_id?: string;
  player_position_id?: string;
  rank_ecr?: number;
  pos_rank?: string;
  tier?: number;
}

/** Map per-position ECR onto a single overall board. Public v2 has no `position=ALL`. */
export function estimatedOverall(position: string, ecr: number): number {
  switch (position) {
    case "RB":
      return ecr * 1.55;
    case "WR":
      return ecr * 1.45;
    case "TE":
      return 8 + ecr * 4.2;
    case "QB":
      return 18 + ecr * 9;
    case "DEF":
      return 175 + ecr;
    case "K":
      return 190 + ecr;
    default:
      return 300 + ecr;
  }
}

export function mergeFantasyProsPlayers(
  rows: readonly FpPlayer[],
): ChenPlayerRecord[] {
  const mapped: ChenPlayerRecord[] = [];
  const positionCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.player_name?.trim();
    const rawPos = String(row.player_position_id ?? "").toUpperCase();
    const position = rawPos === "DST" || rawPos === "D/ST" ? "DEF" : rawPos;
    if (!name || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(position)) continue;
    const pos = position as ChenPlayerRecord["position"];
    const nextRank = (positionCounts.get(pos) ?? 0) + 1;
    positionCounts.set(pos, nextRank);
    mapped.push({
      sourceId: `fp:${pos}:${name.toLowerCase()}`,
      name,
      position: pos,
      team: row.player_team_id?.toUpperCase(),
      tier: row.tier ?? Math.ceil((mapped.length + 1) / 12),
      positionRank: row.rank_ecr ?? nextRank,
      overallRank: 0,
      adp: row.rank_ecr,
    });
  }
  mapped.sort(
    (left, right) =>
      estimatedOverall(left.position, left.positionRank ?? 99) -
        estimatedOverall(right.position, right.positionRank ?? 99) ||
      left.name.localeCompare(right.name),
  );
  return mapped.map((player, index) => ({
    ...player,
    overallRank: index + 1,
    adp: index + 1,
  }));
}

export async function fetchFantasyProsImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const key = process.env.FANTASYPROS_API_KEY?.trim();
  if (!key) return null;
  const cacheSource = `fantasypros-${scoring}`;
  const year = new Date().getUTCFullYear();
  const scoringCode = SCORING[scoring];
  try {
    const pages: FpPlayer[][] = [];
    for (const [index, position] of FP_POSITIONS.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      const url = `${FP_BASE}/nfl/${year}/consensus-rankings?position=${position}&scoring=${scoringCode}`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "FantasyPros rejected this key. Confirm it is a premium/HOF key and FANTASYPROS_API_KEY is set, then retry",
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
      pages.push(body.players ?? []);
    }
    const players = mergeFantasyProsPlayers(pages.flat());
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
