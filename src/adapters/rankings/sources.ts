import type { ChenImport, ChenScoring } from "@/adapters/chen/boris-chen";
import { CHEN_SCORING, parseChenScoring } from "@/adapters/chen/boris-chen";
import { fetchChenImport } from "@/adapters/chen/server-cache";
import { fetchFfCalculatorImport } from "@/adapters/rankings/ffcalculator";
import { fetchFantasyProsImport } from "@/adapters/rankings/fantasypros";

export const RANKING_SOURCES = {
  chen: { id: "chen", label: "Boris Chen" },
  fantasypros: { id: "fantasypros", label: "FantasyPros ECR" },
  ffcalc: { id: "ffcalc", label: "FF Calculator ADP" },
} as const;

export type RankingSourceId = keyof typeof RANKING_SOURCES;

export function parseRankingSource(value?: string | null): RankingSourceId {
  if (value === "fantasypros" || value === "ffcalc" || value === "chen") return value;
  return "chen";
}

export { sourceFromBoard } from "./labels";

export function availableRankingSources() {
  return [
    { ...RANKING_SOURCES.chen, available: true },
    {
      ...RANKING_SOURCES.fantasypros,
      available: Boolean(process.env.FANTASYPROS_API_KEY?.trim()),
    },
    { ...RANKING_SOURCES.ffcalc, available: true },
  ];
}

export async function fetchRankingImport(
  source: RankingSourceId,
  scoring: ChenScoring = parseChenScoring(undefined),
): Promise<ChenImport | null> {
  if (source === "fantasypros") return fetchFantasyProsImport(scoring);
  if (source === "ffcalc") return fetchFfCalculatorImport(scoring);
  return fetchChenImport(scoring);
}

export { CHEN_SCORING, parseChenScoring };
