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
  scoring?: ChenScoring;
  /**
   * Specialist lists already considered for this import (`K`, or empty).
   * Absent on caches written before kicker merge — those should be refetched.
   */
  extras?: readonly string[];
}

export const CHEN_SCORING = {
  "half-ppr": {
    label: "0.5 PPR",
    url:
      process.env.CHEN_HALF_PPR_CSV_URL ??
      "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-HALF-PPR.csv",
    cacheSource: "boris-chen-half-ppr",
  },
  ppr: {
    label: "PPR",
    url:
      process.env.CHEN_PPR_CSV_URL ??
      "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-PPR.csv",
    cacheSource: "boris-chen-ppr",
  },
  standard: {
    label: "Standard",
    url:
      process.env.CHEN_STANDARD_CSV_URL ??
      "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL.csv",
    cacheSource: "boris-chen-standard",
  },
} as const;

export type ChenScoring = keyof typeof CHEN_SCORING;
export const DEFAULT_CHEN_SCORING: ChenScoring = "half-ppr";

/** Kickers are published as their own file; the ALL lists omit them. */
export const CHEN_KICKER = {
  url:
    process.env.CHEN_K_CSV_URL ??
    "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-K.csv",
} as const;

export function scoringFromSource(source?: string | null): ChenScoring {
  const text = source ?? "";
  if (/half|0\.5/i.test(text)) return "half-ppr";
  if (/weekly-ALL\.csv/i.test(text) || (/standard/i.test(text) && !/ppr/i.test(text))) {
    return "standard";
  }
  if (/ppr/i.test(text)) return "ppr";
  return DEFAULT_CHEN_SCORING;
}

export function parseChenScoring(value?: string | null): ChenScoring {
  if (value === "ppr" || value === "standard" || value === "half-ppr") return value;
  return DEFAULT_CHEN_SCORING;
}

const aliases = {
  name: ["Player.Name", "Player", "Name", "player_name"],
  position: ["Position", "Pos", "position"],
  team: ["Team", "team"],
  tier: ["Tier", "tier"],
  positionRank: ["Position.Rank", "Pos.Rank", "Position Rank", "position_rank"],
  overallRank: ["Overall.Rank", "Rank", "Overall Rank", "overall_rank"],
  bye: ["Bye", "Bye.Week", "bye_week"],
  adp: ["ADP", "Average.Draft.Position", "Avg.Rank", "Avg Rank", "adp"],
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

/**
 * Append a position-only Chen file (kickers) after the overall list.
 * Specialist CSVs restart Rank at 1, so overall rank and ADP are offset
 * past the last ALL player — otherwise Aubrey would sort as overall #1.
 */
export function appendChenSpecialists(
  base: ChenImport,
  specialist: ChenImport,
  extraLabel = "K",
): ChenImport {
  const seen = new Set(base.players.map((player) => player.sourceId));
  const baseMax = base.players.reduce(
    (max, player) => Math.max(max, player.overallRank),
    0,
  );
  const appended = specialist.players
    .filter((player) => !seen.has(player.sourceId))
    .map((player) => ({
      ...player,
      overallRank: baseMax + player.overallRank,
      adp: player.adp === undefined ? undefined : baseMax + player.adp,
    }));
  if (appended.length === 0) {
    return {
      ...base,
      warnings: [...base.warnings, ...specialist.warnings],
      extras: [...(base.extras ?? [])],
    };
  }
  return {
    ...base,
    players: [...base.players, ...appended].sort(
      (left, right) => left.overallRank - right.overallRank,
    ),
    source: `${base.source} + ${extraLabel}`,
    warnings: [...base.warnings, ...specialist.warnings],
    extras: [...(base.extras ?? []), extraLabel],
  };
}

export interface ChenDataAdapter {
  parse(csv: string, source?: string): ChenImport;
}

export const borisChenAdapter: ChenDataAdapter = {
  parse: parseChenCsv,
};
