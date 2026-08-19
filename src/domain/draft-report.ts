import { analyzeDraftRoster } from "./draft-insights";
import { rosterPicks } from "./roster";
import type { DraftState, Pick, Player, Position } from "./types";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const STARTER_NEED: Readonly<Record<Position, number>> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
};

export type LetterGrade =
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

export interface ReportHighlight {
  readonly name: string;
  readonly detail: string;
}

export interface TeamReportCard {
  readonly slot: number;
  readonly grade: LetterGrade;
  readonly score: number;
  readonly avgChenRank: number | null;
  readonly positionCounts: Readonly<Record<Position, number>>;
  readonly holes: readonly string[];
  readonly steal: ReportHighlight | null;
  readonly reach: ReportHighlight | null;
  readonly byeAlert: string | null;
  readonly headline: string;
  readonly picks: readonly Pick[];
}

export interface DraftBoardReport {
  readonly complete: boolean;
  readonly totalPicks: number;
  readonly teams: readonly TeamReportCard[];
}

export function letterGrade(score: number): LetterGrade {
  if (score >= 0.84) return "A";
  if (score >= 0.78) return "A-";
  if (score >= 0.72) return "B+";
  if (score >= 0.66) return "B";
  if (score >= 0.6) return "B-";
  if (score >= 0.54) return "C+";
  if (score >= 0.48) return "C";
  if (score >= 0.42) return "C-";
  if (score >= 0.32) return "D";
  return "F";
}

function positionCounts(roster: readonly Pick[]): Record<Position, number> {
  const counts: Record<Position, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0,
  };
  for (const pick of roster) counts[pick.player.position] += 1;
  return counts;
}

function pickValue(pick: Pick): number | null {
  return pick.player.chenRank === undefined
    ? null
    : pick.overall - pick.player.chenRank;
}

function highlight(
  roster: readonly Pick[],
  compare: (left: number, right: number) => number,
  qualifies: (value: number) => boolean,
  label: (player: Player, value: number) => string,
): ReportHighlight | null {
  let best: { player: Player; value: number } | null = null;
  for (const pick of roster) {
    const value = pickValue(pick);
    if (value === null) continue;
    if (!best || compare(value, best.value) > 0) {
      best = { player: pick.player, value };
    }
  }
  if (!best || !qualifies(best.value)) return null;
  return { name: best.player.name, detail: label(best.player, best.value) };
}

function gradeTeam(roster: readonly Pick[], currentRound: number): TeamReportCard {
  const slot = roster[0]?.slot ?? 0;
  const counts = positionCounts(roster);
  const holes = POSITIONS.filter(
    (position) => counts[position] < STARTER_NEED[position],
  ).map((position) =>
    STARTER_NEED[position] === 1
      ? `No ${position}`
      : `${counts[position]}/${STARTER_NEED[position]} ${position}`,
  );

  const ranked = roster.filter((pick) => pick.player.chenRank !== undefined);
  const avgChenRank = ranked.length
    ? ranked.reduce((sum, pick) => sum + (pick.player.chenRank ?? 0), 0) /
      ranked.length
    : null;
  const values = roster
    .map(pickValue)
    .filter((value): value is number => value !== null);
  const avgValue =
    values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;

  const insights = analyzeDraftRoster(roster, { currentRound });
  const bye = insights.byes.find((group) => group.count >= 3);
  const flag = insights.alerts.find((alert) => alert.severity !== "info");

  const talent = avgChenRank === null ? 0.5 : clamp(1 - (avgChenRank - 1) / 160);
  const value = clamp(0.5 + avgValue / 36);
  const build = clamp(
    1 - holes.length * 0.14 - (bye && bye.count >= 4 ? 0.16 : bye ? 0.08 : 0),
  );
  const score = clamp(talent * 0.46 + value * 0.32 + build * 0.22);

  const steal = highlight(
    roster,
    (left, right) => left - right,
    (value) => value >= 8,
    (player, value) =>
      `Chen ${player.chenRank} at pick ${roster.find((pick) => pick.player.id === player.id)?.overall} (+${Math.round(value)})`,
  );
  const reach = highlight(
    roster,
    (left, right) => right - left,
    (value) => value <= -12,
    (player, value) =>
      `Chen ${player.chenRank} at pick ${roster.find((pick) => pick.player.id === player.id)?.overall} (${Math.round(value)})`,
  );

  return {
    slot,
    grade: letterGrade(score),
    score,
    avgChenRank: avgChenRank === null ? null : Math.round(avgChenRank * 10) / 10,
    positionCounts: counts,
    holes,
    steal,
    reach,
    byeAlert: bye
      ? `Bye ${bye.week} · ${bye.count} (${bye.names.join(", ")})`
      : null,
    headline: flag?.title ?? (holes.length ? `Missing ${holes[0]}` : "Clean build"),
    picks: roster,
  };
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function buildDraftReport(state: DraftState): DraftBoardReport {
  const totalPicks = state.teamCount * state.rounds;
  const complete = state.picks.length >= totalPicks;
  const currentRound = Math.min(
    state.rounds,
    Math.max(1, Math.ceil(state.picks.length / state.teamCount) || 1),
  );
  const teams = Array.from({ length: state.teamCount }, (_, index) => {
    const slot = index + 1;
    const roster = rosterPicks(state.picks, slot);
    if (roster.length === 0) {
      return {
        slot,
        grade: "F" as const,
        score: 0,
        avgChenRank: null,
        positionCounts: positionCounts([]),
        holes: POSITIONS.map((position) =>
          STARTER_NEED[position] === 1
            ? `No ${position}`
            : `0/${STARTER_NEED[position]} ${position}`,
        ),
        steal: null,
        reach: null,
        byeAlert: null,
        headline: "No picks yet",
        picks: [],
      };
    }
    return gradeTeam(roster, currentRound);
  }).sort((left, right) => right.score - left.score || left.slot - right.slot);

  return { complete, totalPicks, teams };
}
