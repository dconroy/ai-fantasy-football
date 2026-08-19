/**
 * 2026 NFL bye weeks, keyed by the canonical team abbreviation used in
 * `src/domain/identity.ts` (`TEAM_ALIASES`). Byes are fixed for the season once
 * the schedule is released, so a static map is the most reliable source — Boris
 * Chen's tier file has no bye column and Sleeper's player payload omits byes.
 *
 * Source: 2026 NFL schedule release (byes run Week 5–14, none in Week 12).
 */
export const NFL_BYE_WEEKS_2026: Readonly<Record<string, number>> = {
  ARI: 14,
  ATL: 11,
  BAL: 13,
  BUF: 7,
  CAR: 5,
  CHI: 10,
  CIN: 6,
  CLE: 11,
  DAL: 14,
  DEN: 10,
  DET: 6,
  GB: 11,
  HOU: 8,
  IND: 13,
  JAX: 7,
  KC: 5,
  LV: 13,
  LAC: 7,
  LAR: 11,
  MIA: 6,
  MIN: 6,
  NE: 11,
  NO: 8,
  NYG: 8,
  NYJ: 13,
  PHI: 10,
  PIT: 9,
  SEA: 11,
  SF: 8,
  TB: 10,
  TEN: 9,
  WAS: 7,
};

/** Look up a team's 2026 bye week by any team name/abbreviation alias. */
export function byeWeekForTeam(canonicalAbbr: string | null): number | undefined {
  if (!canonicalAbbr) return undefined;
  return NFL_BYE_WEEKS_2026[canonicalAbbr.toUpperCase()];
}
