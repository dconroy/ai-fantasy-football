import type { Player, Position } from "@/domain/types";

const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;

const POSITION_PATTERN: readonly Position[] = [
  "RB", "WR", "WR", "RB", "WR", "RB", "TE", "WR", "QB", "RB",
  "WR", "RB", "WR", "TE", "WR", "RB", "QB", "WR", "RB", "TE",
];

const positionRanks: Record<Position, number> = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  K: 0,
  DEF: 0,
};

function tierFor(position: Position, positionRank: number) {
  if (position === "K" || position === "DEF") return Math.ceil(positionRank / 5);
  if (position === "QB" || position === "TE") return Math.ceil(positionRank / 4);
  return Math.ceil(positionRank / 7);
}

const skillPlayers: Player[] = Array.from({ length: 180 }, (_, index) => {
  const position = POSITION_PATTERN[index % POSITION_PATTERN.length];
  const positionRank = ++positionRanks[position];
  const overall = index + 1;
  return {
    id: `mock-${position.toLowerCase()}-${positionRank}`,
    name: `Mock ${position} ${String(positionRank).padStart(2, "0")}`,
    position,
    team: TEAMS[index % TEAMS.length],
    byeWeek: 5 + (index % 10),
    chenRank: overall,
    chenTier: tierFor(position, positionRank),
    adp: Math.max(1, overall + ((index % 7) - 3)),
  };
});

const specialists: Player[] = (["K", "DEF"] as const).flatMap((position) =>
  Array.from({ length: 18 }, (_, index) => ({
    id: `mock-${position.toLowerCase()}-${index + 1}`,
    name: `Mock ${position} ${String(index + 1).padStart(2, "0")}`,
    position,
    team: TEAMS[(index + (position === "DEF" ? 7 : 0)) % TEAMS.length],
    byeWeek: 5 + (index % 10),
    chenRank: 181 + index + (position === "DEF" ? 18 : 0),
    chenTier: tierFor(position, index + 1),
    adp: 165 + index + (position === "DEF" ? 4 : 0),
  })),
);

/**
 * Synthetic fixture—not a claim about 2026 player value. Import a current
 * Boris Chen CSV before using rankings for a real draft.
 */
export const MOCK_PLAYERS: readonly Player[] = [...skillPlayers, ...specialists];
