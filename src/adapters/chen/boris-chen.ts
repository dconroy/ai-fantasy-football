import Papa from "papaparse";

export type ChenPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface ChenPlayerRecord {
  sourceId: string;
  name: string;
  position: ChenPosition;
  team?: string;
  tier: number;
  positionRank: number;
  overallRank: number;
  byeWeek?: number;
  adp?: number;
}

export interface ChenImport {
  players: ChenPlayerRecord[];
  importedAt: string;
  source: string;
  warnings: string[];
}

const aliases = {
  name: ["Player.Name", "Player", "Name", "player_name"],
  position: ["Position", "Pos", "position"],
  team: ["Team", "team"],
  tier: ["Tier", "tier"],
  positionRank: ["Position.Rank", "Pos.Rank", "Position Rank", "position_rank"],
  overallRank: ["Overall.Rank", "Rank", "Overall Rank", "overall_rank"],
  bye: ["Bye", "Bye.Week", "bye_week"],
  adp: ["ADP", "Average.Draft.Position", "adp"],
} as const;

function value(row: Record<string, string>, keys: readonly string[]) {
  for (const key of keys) {
    const candidate = row[key]?.trim();
    if (candidate) return candidate;
  }
}

function numberValue(raw?: string) {
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePosition(raw?: string): ChenPosition | undefined {
  const position = raw?.toUpperCase().replace(/\s/g, "");
  if (position === "DST" || position === "D/ST") return "DEF";
  if (["QB", "RB", "WR", "TE", "K", "DEF"].includes(position ?? "")) {
    return position as ChenPosition;
  }
}

export function parseChenCsv(
  csv: string,
  source = "manual CSV",
  importedAt = new Date().toISOString(),
): ChenImport {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().replace(/^["']|["']$/g, ""),
  });
  const warnings = parsed.errors.map(
    (error) => `CSV row ${error.row ?? "?"}: ${error.message}`,
  );
  const positionCounts = new Map<ChenPosition, number>();
  const players: ChenPlayerRecord[] = [];

  for (const [index, row] of parsed.data.entries()) {
    const name = value(row, aliases.name);
    const position = normalizePosition(value(row, aliases.position));
    const tier = numberValue(value(row, aliases.tier));
    if (!name || !position || tier === undefined) {
      warnings.push(`Skipped row ${index + 2}: name, position, and tier are required.`);
      continue;
    }
    const nextPositionRank = (positionCounts.get(position) ?? 0) + 1;
    positionCounts.set(position, nextPositionRank);
    const positionRank =
      numberValue(value(row, aliases.positionRank)) ?? nextPositionRank;
    const overallRank =
      numberValue(value(row, aliases.overallRank)) ?? players.length + 1;
    players.push({
      sourceId: `chen:${position}:${name.toLowerCase()}`,
      name,
      position,
      team: value(row, aliases.team)?.toUpperCase(),
      tier,
      positionRank,
      overallRank,
      byeWeek: numberValue(value(row, aliases.bye)),
      adp: numberValue(value(row, aliases.adp)),
    });
  }

  players.sort((a, b) => a.overallRank - b.overallRank);
  return { players, importedAt, source, warnings };
}

export interface ChenDataAdapter {
  parse(csv: string, source?: string): ChenImport;
}

export const borisChenAdapter: ChenDataAdapter = {
  parse: parseChenCsv,
};
