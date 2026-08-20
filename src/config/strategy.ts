import type { RosterSlotLimits, StrategyWeights } from "../domain/types";

export const DEFAULT_ROSTER_LIMITS: RosterSlotLimits = Object.freeze({
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
  BENCH: 6,
  IR: 1,
});

export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = Object.freeze({
  chenRank: 34,
  chenTier: 18,
  tierCliff: 16,
  positionalScarcity: 12,
  positionalNeed: 18,
  flexValue: 7,
  rosterBalance: 8,
  turnUrgency: 13,
  adpValue: 7,
  byeConcentration: 32,
  teamConcentration: 2,
  earlySpecialist: 100,
  backupPenalty: 18,
  lineupCompleteness: 50,
});

export interface StrategyConfig {
  readonly weights: StrategyWeights;
  readonly rosterLimits: RosterSlotLimits;
  readonly specialistRound: Readonly<{ K: number; DEF: number }>;
  readonly topCount: number;
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = Object.freeze({
  weights: DEFAULT_STRATEGY_WEIGHTS,
  rosterLimits: DEFAULT_ROSTER_LIMITS,
  specialistRound: Object.freeze({ K: 13, DEF: 13 }),
  topCount: 5,
});

/** Rostered players already on this bye: no Top Five penalty. */
export const BYE_STACK_OK = 2;
/** Rostered players on this bye: full Top Five penalty so elites drop. */
export const BYE_STACK_PENALIZE = 3;
/** Rostered players on this bye: drop from Top Five when anyone else is viable. */
export const BYE_STACK_EXCLUDE = 4;

/**
 * Mutating draft behavior is deliberately opt-in. UI and sync adapters should
 * read this configuration rather than assuming recommendations may make picks.
 */
export const AUTOMATIC_BEHAVIOR = Object.freeze({
  enabled: false,
  autoPick: false,
  autoSync: false,
});
