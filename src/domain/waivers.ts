/**
 * Waiver Wire Sniper. Pure domain logic: takes the league's free agents (Yahoo
 * positions + Chen ranks already merged), your current roster, the league's
 * lineup shape, recent league activity, and your private watchlist, and ranks
 * the pickups that actually help *your* team.
 *
 * Every target carries explainable, weighted factors — a starter it would beat,
 * a need it fills, a hidden gem others are sleeping on, or a contested add a
 * rival is about to grab. Advisory only: Yahoo's API is read-only, so the user
 * still makes the claim in the Yahoo app.
 */

import { normalizePlayerName } from "./identity";
import {
  isUnplayable,
  type LineupPlayer,
  type LineupSlots,
  optimizeLineup,
} from "./lineup";
import type {
  WaiverFactor,
  WaiverFactorBreakdown,
  WaiverPlayerRef,
  WaiverTarget,
} from "./types";

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.max(minimum, Math.min(maximum, value));

/** Relative pull of each factor; starter upgrades dominate, watchlist pins. */
const WEIGHTS: Readonly<Record<WaiverFactor, number>> = {
  starterUpgrade: 3,
  positionalNeed: 2,
  watchlisted: 1.5,
  chenValue: 1,
  trending: 0.7,
  hiddenGem: 0.8,
  contested: 0.6,
};

const FLEX_POSITIONS = new Set(["WR", "RB", "TE"]);
/** Chen rank worse than this means the raw ranking is unavailable/irrelevant. */
const NO_RANK = 400;

export interface WaiverCandidate {
  readonly id: string;
  readonly name: string;
  readonly position: string;
  readonly team: string;
  readonly status?: string;
  readonly byeWeek?: number;
  readonly percentOwned?: number;
  readonly chenRank?: number;
  readonly chenTier?: number;
}

export interface RankWaiverInput {
  readonly freeAgents: readonly WaiverCandidate[];
  readonly roster: readonly LineupPlayer[];
  readonly slots: LineupSlots;
  readonly currentWeek?: number;
  /** Normalized-or-raw player names being added around the league right now. */
  readonly hotAddNames?: readonly string[];
  /** Player ids or names the manager is watching. */
  readonly watchlist?: readonly string[];
  readonly topCount?: number;
}

/** Lower is better. Unplayable options sort behind every healthy one. */
function rankValue(rank: number | undefined, unplayable: boolean): number {
  const base = rank ?? NO_RANK;
  return unplayable ? base + 10_000 : base;
}

function toRef(player: LineupPlayer): WaiverPlayerRef {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    chenRank: player.chenRank,
    chenTier: player.chenTier,
  };
}

function eligibleSlots(position: string): string[] {
  return FLEX_POSITIONS.has(position) ? [position, "FLEX"] : [position];
}

export function rankWaiverTargets(input: RankWaiverInput): WaiverTarget[] {
  const { freeAgents, roster, slots, currentWeek } = input;
  const watchKeys = new Set(input.watchlist ?? []);
  const watchNames = new Set(
    (input.watchlist ?? []).map((entry) => normalizePlayerName(entry)),
  );
  const hotAdds = new Set(
    (input.hotAddNames ?? []).map((name) => normalizePlayerName(name)),
  );

  const optimal = optimizeLineup({ players: roster, slots, currentWeek });

  // The most expendable roster player: the worst-ranked one on the bench.
  const worstBench = optimal.bench.at(-1) ?? null;
  const suggestedDrop = worstBench ? toRef(worstBench) : null;

  const rosterCountByPosition = new Map<string, number>();
  for (const player of roster) {
    if (isUnplayable(player, currentWeek)) continue;
    rosterCountByPosition.set(
      player.position,
      (rosterCountByPosition.get(player.position) ?? 0) + 1,
    );
  }

  const isWatched = (candidate: WaiverCandidate): boolean =>
    watchKeys.has(candidate.id) ||
    watchNames.has(normalizePlayerName(candidate.name));

  const targets = freeAgents.map((candidate) => {
    const position = candidate.position;
    const unplayable = isUnplayable(
      {
        id: candidate.id,
        name: candidate.name,
        position,
        team: candidate.team,
        selectedSlot: "BN",
        byeWeek: candidate.byeWeek,
        status: candidate.status,
      },
      currentWeek,
    );
    const faValue = rankValue(candidate.chenRank, unplayable);

    const slotLabels = eligibleSlots(position);
    const eligibleStarters = optimal.starters.filter((entry) =>
      slotLabels.includes(entry.slot),
    );

    // Find the weakest lineup spot this pickup could take over.
    let emptySlot: string | null = null;
    let weakest: { player: LineupPlayer; value: number } | null = null;
    for (const entry of eligibleStarters) {
      if (!entry.player) {
        emptySlot = entry.slot;
        continue;
      }
      const value = rankValue(
        entry.player.chenRank,
        isUnplayable(entry.player, currentWeek),
      );
      if (!weakest || value > weakest.value) {
        weakest = { player: entry.player, value };
      }
    }
    const weakestUnavailable =
      weakest !== null && isUnplayable(weakest.player, currentWeek);

    const factors: WaiverFactorBreakdown[] = [];
    let upgradeOver: WaiverPlayerRef | null = null;

    const chenRankSignal =
      candidate.chenRank !== undefined
        ? clamp(1 - (candidate.chenRank - 1) / 199)
        : candidate.chenTier !== undefined
          ? clamp(1 - (candidate.chenTier - 1) / 11)
          : 0;
    factors.push(
      makeFactor("chenValue", chenRankSignal, {
        explanation:
          candidate.chenRank !== undefined
            ? `Chen rank ${candidate.chenRank}${candidate.chenTier ? ` (tier ${candidate.chenTier})` : ""}`
            : candidate.chenTier !== undefined
              ? `Chen tier ${candidate.chenTier}`
              : "No Chen ranking available",
      }),
    );

    let upgradeSignal = 0;
    let upgradeExplanation = `Depth behind your current ${position}s`;
    if (emptySlot) {
      upgradeSignal = 1;
      upgradeExplanation = `Fills your empty ${emptySlot} slot`;
    } else if (weakest && faValue < weakest.value) {
      upgradeSignal = clamp((weakest.value - faValue) / 60, 0.15, 1);
      upgradeOver = toRef(weakest.player);
      upgradeExplanation = weakestUnavailable
        ? `Steps in for ${weakest.player.name} (${unavailabilityNote(weakest.player, currentWeek)})`
        : `Would start over ${weakest.player.name} (Chen ${candidate.chenRank ?? "—"} vs ${weakest.player.chenRank ?? "—"})`;
    }
    factors.push(
      makeFactor("starterUpgrade", upgradeSignal, {
        explanation: upgradeExplanation,
      }),
    );

    let needSignal = 0;
    let needExplanation = `You have enough ${position} depth`;
    if (emptySlot) {
      needSignal = 1;
      needExplanation = `You have an unfilled ${emptySlot} slot`;
    } else if (weakestUnavailable && weakest) {
      needSignal = 0.85;
      needExplanation = `${weakest.player.name} is ${unavailabilityNote(weakest.player, currentWeek)} — you need a fill-in`;
    } else {
      const posCount = rosterCountByPosition.get(position) ?? 0;
      const starters = slots[position as keyof LineupSlots] ?? 0;
      const target = starters + (FLEX_POSITIONS.has(position) ? 1 : 0) + 1;
      if (posCount < target) {
        needSignal = clamp((target - posCount) / target, 0, 0.5);
        needExplanation = `Only ${posCount} healthy ${position} on your roster`;
      }
    }
    factors.push(
      makeFactor("positionalNeed", needSignal, { explanation: needExplanation }),
    );

    let gemSignal = 0;
    let gemExplanation = "";
    if (
      candidate.percentOwned !== undefined &&
      candidate.chenRank !== undefined &&
      candidate.chenRank <= 180 &&
      candidate.percentOwned < 35
    ) {
      gemSignal =
        clamp((35 - candidate.percentOwned) / 35) *
        clamp(1 - (candidate.chenRank - 1) / 180);
      gemExplanation = `Only ${candidate.percentOwned}% rostered despite Chen rank ${candidate.chenRank}`;
    }
    if (gemSignal > 0) {
      factors.push(makeFactor("hiddenGem", gemSignal, { explanation: gemExplanation }));
    }

    let contestedSignal = 0;
    if (candidate.percentOwned !== undefined && candidate.percentOwned >= 45) {
      contestedSignal = clamp((candidate.percentOwned - 45) / 55);
      factors.push(
        makeFactor("contested", contestedSignal, {
          explanation: `${candidate.percentOwned}% rostered — grab before a rival does`,
        }),
      );
    }

    const isTrending = hotAdds.has(normalizePlayerName(candidate.name));
    if (isTrending) {
      factors.push(
        makeFactor("trending", 1, {
          explanation: "Being added around your league right now",
        }),
      );
    }

    const watched = isWatched(candidate);
    if (watched) {
      factors.push(
        makeFactor("watchlisted", 1, { explanation: "On your watchlist" }),
      );
    }

    const score = factors.reduce((sum, factor) => sum + factor.contribution, 0);
    const fillsNeed = needSignal >= 0.5;
    const worthMove = upgradeSignal > 0 || fillsNeed || watched;

    const reasons = factors
      .filter((factor) => factor.contribution > 0.01)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map((factor) => factor.explanation);

    return {
      player: {
        id: candidate.id,
        name: candidate.name,
        position,
        team: candidate.team,
        status: candidate.status,
        byeWeek: candidate.byeWeek,
        percentOwned: candidate.percentOwned,
        chenRank: candidate.chenRank,
        chenTier: candidate.chenTier,
      },
      score,
      factors,
      reasons,
      upgradeOver,
      suggestedDrop: worthMove ? suggestedDrop : null,
      fillsNeed,
      isContested: contestedSignal > 0,
      isTrending,
      isWatched: watched,
    } satisfies WaiverTarget;
  });

  targets.sort((a, b) => {
    // Watched players are always pinned to the top, then by raw score.
    if (a.isWatched !== b.isWatched) return a.isWatched ? -1 : 1;
    return b.score - a.score;
  });

  const topCount = input.topCount;
  return topCount !== undefined ? targets.slice(0, topCount) : targets;
}

function makeFactor(
  factor: WaiverFactor,
  value: number,
  { explanation }: { explanation: string },
): WaiverFactorBreakdown {
  const clamped = clamp(value, -1, 1);
  const weight = WEIGHTS[factor];
  return {
    factor,
    value: clamped,
    weight,
    contribution: clamped * weight,
    explanation,
  };
}

function unavailabilityNote(player: LineupPlayer, currentWeek?: number): string {
  if (currentWeek !== undefined && player.byeWeek === currentWeek) return "on bye";
  const status = player.status?.toUpperCase();
  if (!status) return "unavailable";
  if (status === "O") return "ruled out";
  if (status.startsWith("IR")) return "on IR";
  if (status.startsWith("PUP")) return "on PUP";
  if (status === "SUSP") return "suspended";
  if (status === "NA") return "inactive";
  if (status === "D") return "doubtful";
  if (status === "Q") return "questionable";
  return "unavailable";
}
