import { prisma } from "@/persistence/prisma";
import type { ChenImport, ChenPlayerRecord, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING } from "@/adapters/chen/boris-chen";

const FORMAT: Record<ChenScoring, string> = {
  "half-ppr": "half-ppr",
  ppr: "ppr",
  standard: "standard",
};

interface FfPlayer {
  name?: string;
  position?: string;
  team?: string;
  adp?: number;
  bye?: number;
}

function synthesizeTier(adp: number, previousAdp: number | null, previousTier: number) {
  if (previousAdp === null) return 1;
  if (adp - previousAdp >= 8) return previousTier + 1;
  return previousTier;
}

export async function fetchFfCalculatorImport(
  scoring: ChenScoring,
): Promise<ChenImport | null> {
  const format = FORMAT[scoring];
  const cacheSource = `ffcalc-${scoring}`;
  const year = new Date().getUTCFullYear();
  const url = `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=12&year=${year}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`FF Calculator returned ${response.status}`);
    const body = (await response.json()) as { players?: FfPlayer[] };
    const raw = body.players ?? [];
    const players: ChenPlayerRecord[] = [];
    let previousAdp: number | null = null;
    let tier = 1;
    const positionCounts = new Map<string, number>();
    for (const row of raw) {
      const name = row.name?.trim();
      const position = String(row.position ?? "").toUpperCase();
      if (!name || !["QB", "RB", "WR", "TE", "K", "DEF", "DST"].includes(position)) {
        continue;
      }
      const pos = position === "DST" ? "DEF" : (position as ChenPlayerRecord["position"]);
      const adp = typeof row.adp === "number" ? row.adp : players.length + 1;
      tier = synthesizeTier(adp, previousAdp, tier);
      previousAdp = adp;
      const nextRank = (positionCounts.get(pos) ?? 0) + 1;
      positionCounts.set(pos, nextRank);
      players.push({
        sourceId: `ffcalc:${pos}:${name.toLowerCase()}`,
        name,
        position: pos,
        team: row.team?.toUpperCase(),
        tier,
        positionRank: nextRank,
        overallRank: players.length + 1,
        byeWeek: row.bye,
        adp,
      });
    }
    if (players.length === 0) return null;
    const imported: ChenImport = {
      players,
      importedAt: new Date().toISOString(),
      source: `FF Calculator ADP · ${CHEN_SCORING[scoring].label}`,
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
  } catch {
    const cached = await prisma.dataImport.findFirst({
      where: { source: cacheSource },
      orderBy: { fetchedAt: "desc" },
    });
    if (!cached) return null;
    return JSON.parse(cached.payload) as ChenImport;
  }
}
