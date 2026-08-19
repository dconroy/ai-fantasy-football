import { DEFAULT_STRATEGY_CONFIG } from "../config/strategy";
import type { Pick, Position } from "./types";

export type InsightSeverity = "critical" | "warning" | "info";

export interface DraftInsight {
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly detail: string;
}

export interface ByeGroup {
  readonly week: number;
  readonly count: number;
  readonly names: readonly string[];
}

export interface DraftInsightReport {
  readonly alerts: readonly DraftInsight[];
  readonly byes: readonly ByeGroup[];
  readonly positionCounts: Readonly<Record<Position, number>>;
}

export interface DraftInsightOptions {
  readonly currentRound: number;
  readonly topPick?: { name: string; reason: string };
  readonly specialistRound?: { readonly K: number; readonly DEF: number };
}

const EMPTY_COUNTS: Record<Position, number> = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  K: 0,
  DEF: 0,
};

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Roster-level draft advice: bye stacks, position holes, team piles, and
 * a couple of "don't do this yet" flags. Advisory only — it never picks.
 */
export function analyzeDraftRoster(
  roster: readonly Pick[],
  options: DraftInsightOptions,
): DraftInsightReport {
  const specialistRound =
    options.specialistRound ?? DEFAULT_STRATEGY_CONFIG.specialistRound;
  const players = roster.map((pick) => pick.player);
  const positionCounts: Record<Position, number> = { ...EMPTY_COUNTS };
  for (const player of players) positionCounts[player.position] += 1;

  const byeMap = new Map<number, string[]>();
  for (const player of players) {
    if (player.byeWeek === undefined) continue;
    const names = byeMap.get(player.byeWeek) ?? [];
    names.push(player.name);
    byeMap.set(player.byeWeek, names);
  }
  const byes = [...byeMap.entries()]
    .map(([week, names]) => ({ week, count: names.length, names }))
    .sort((left, right) => right.count - left.count || left.week - right.week);

  const alerts: DraftInsight[] = [];
  const round = options.currentRound;

  for (const group of byes) {
    if (group.count >= 4) {
      alerts.push({
        id: `bye-${group.week}`,
        severity: "critical",
        title: `Week ${group.week} bye pile-up`,
        detail: `${group.count} players sit week ${group.week}: ${group.names.join(", ")}. That week your lineup will have holes.`,
      });
    } else if (group.count >= 3) {
      alerts.push({
        id: `bye-${group.week}`,
        severity: "warning",
        title: `3 players on bye week ${group.week}`,
        detail: `${group.names.join(", ")} all sit that week. Avoid adding another week-${group.week} bye.`,
      });
    }
  }

  const teamMap = new Map<string, string[]>();
  for (const player of players) {
    if (!player.team || player.team === "FA") continue;
    const names = teamMap.get(player.team) ?? [];
    names.push(player.name);
    teamMap.set(player.team, names);
  }
  for (const [team, names] of teamMap) {
    if (names.length >= 3) {
      alerts.push({
        id: `team-${team}`,
        severity: "warning",
        title: `${team} stack is getting thick`,
        detail: `${names.join(", ")} — one ugly game script hits all of them.`,
      });
    }
  }

  for (const player of players) {
    if (
      !player.injuryStatus ||
      player.injuryStatus === "HEALTHY" ||
      player.injuryStatus === "QUESTIONABLE"
    ) {
      continue;
    }
    alerts.push({
      id: `injury-${player.id}`,
      severity:
        player.injuryStatus === "OUT" || player.injuryStatus === "IR"
          ? "critical"
          : "warning",
      title: `${player.name} is ${player.injuryStatus}`,
      detail: "You're holding a player who may not play. Have a replacement plan.",
    });
  }

  const questionable = players.filter(
    (player) => player.injuryStatus === "QUESTIONABLE",
  );
  if (questionable.length >= 2) {
    alerts.push({
      id: "injury-q-cluster",
      severity: "warning",
      title: `${questionable.length} questionable players`,
      detail: `${questionable.map((player) => player.name).join(", ")} are all Q.`,
    });
  }

  if (round >= 5 && positionCounts.RB === 0) {
    alerts.push({
      id: "need-rb",
      severity: round >= 7 ? "critical" : "warning",
      title: "No running back yet",
      detail: `You're in round ${round} without an RB. The position dries up fast.`,
    });
  }
  if (round >= 6 && positionCounts.WR === 0) {
    alerts.push({
      id: "need-wr",
      severity: round >= 8 ? "critical" : "warning",
      title: "No wide receiver yet",
      detail: `Round ${round} and the WR cupboard is empty.`,
    });
  }
  if (round >= 8 && positionCounts.QB === 0) {
    alerts.push({
      id: "need-qb",
      severity: round >= 11 ? "critical" : "warning",
      title: "Still no quarterback",
      detail: "The starter tier is thinning. Don't wait until the leftovers.",
    });
  }
  if (round >= 9 && positionCounts.TE === 0) {
    alerts.push({
      id: "need-te",
      severity: round >= 12 ? "critical" : "warning",
      title: "Tight end still open",
      detail: "If a usable TE is there, grab one before the streamers.",
    });
  }

  if (positionCounts.RB >= 5 && positionCounts.WR <= 1 && round >= 6) {
    alerts.push({
      id: "rb-heavy",
      severity: "warning",
      title: "RB-heavy, WR-light",
      detail: `${positionCounts.RB} RBs vs ${positionCounts.WR} WR. Flex is covered; starting WRs are not.`,
    });
  }
  if (positionCounts.WR >= 5 && positionCounts.RB <= 1 && round >= 6) {
    alerts.push({
      id: "wr-heavy",
      severity: "warning",
      title: "WR-heavy, RB-light",
      detail: `${positionCounts.WR} WRs vs ${positionCounts.RB} RB. You'll want another back.`,
    });
  }

  if (positionCounts.QB >= 2) {
    alerts.push({
      id: "two-qb",
      severity: "info",
      title: "Two quarterbacks rostered",
      detail: "That's a lot of QB capital unless you're stacking. Bench space is tight.",
    });
  }
  if (positionCounts.TE >= 2) {
    alerts.push({
      id: "two-te",
      severity: "info",
      title: "Two tight ends rostered",
      detail: "Fine if one is a dart throw. Don't take a third.",
    });
  }

  for (const pick of roster) {
    if (pick.player.position === "K" && pick.round < specialistRound.K) {
      alerts.push({
        id: "early-k",
        severity: "warning",
        title: "Kicker taken early",
        detail: `You drafted a kicker in round ${pick.round}. Those points are usually available later.`,
      });
    }
    if (pick.player.position === "DEF" && pick.round < specialistRound.DEF) {
      alerts.push({
        id: "early-def",
        severity: "warning",
        title: "Defense taken early",
        detail: `You drafted a defense in round ${pick.round}. Streaming later is usually cheaper.`,
      });
    }
  }

  if (options.topPick) {
    alerts.push({
      id: "model-lean",
      severity: "info",
      title: `Model lean: ${options.topPick.name}`,
      detail: options.topPick.reason,
    });
  }

  const flagged = alerts.some((alert) => alert.severity !== "info");
  if (!flagged && roster.length >= 3) {
    alerts.unshift({
      id: "balanced",
      severity: "info",
      title: "No red flags yet",
      detail: "Bye weeks and positions look fine. Keep filling starters before luxury backups.",
    });
  }

  alerts.sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  return { alerts, byes, positionCounts };
}
