import type { Player } from "./types";

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ARI: ["ari", "arizona", "arizona cardinals", "cardinals"],
  ATL: ["atl", "atlanta", "atlanta falcons", "falcons"],
  BAL: ["bal", "baltimore", "baltimore ravens", "ravens"],
  BUF: ["buf", "buffalo", "buffalo bills", "bills"],
  CAR: ["car", "carolina", "carolina panthers", "panthers"],
  CHI: ["chi", "chicago", "chicago bears", "bears"],
  CIN: ["cin", "cincinnati", "cincinnati bengals", "bengals"],
  CLE: ["cle", "cleveland", "cleveland browns", "browns"],
  DAL: ["dal", "dallas", "dallas cowboys", "cowboys"],
  DEN: ["den", "denver", "denver broncos", "broncos"],
  DET: ["det", "detroit", "detroit lions", "lions"],
  GB: ["gb", "gnb", "green bay", "green bay packers", "packers"],
  HOU: ["hou", "houston", "houston texans", "texans"],
  IND: ["ind", "indianapolis", "indianapolis colts", "colts"],
  JAX: ["jax", "jac", "jacksonville", "jacksonville jaguars", "jaguars"],
  KC: ["kc", "kan", "kansas city", "kansas city chiefs", "chiefs"],
  LV: ["lv", "lvr", "las vegas", "las vegas raiders", "oakland raiders", "raiders"],
  LAC: ["lac", "los angeles chargers", "la chargers", "chargers"],
  LAR: ["lar", "los angeles rams", "la rams", "rams"],
  MIA: ["mia", "miami", "miami dolphins", "dolphins"],
  MIN: ["min", "minnesota", "minnesota vikings", "vikings"],
  NE: ["ne", "nwe", "new england", "new england patriots", "patriots"],
  NO: ["no", "nor", "new orleans", "new orleans saints", "saints"],
  NYG: ["nyg", "new york giants", "ny giants", "giants"],
  NYJ: ["nyj", "new york jets", "ny jets", "jets"],
  PHI: ["phi", "philadelphia", "philadelphia eagles", "eagles"],
  PIT: ["pit", "pittsburgh", "pittsburgh steelers", "steelers"],
  SEA: ["sea", "seattle", "seattle seahawks", "seahawks"],
  SF: ["sf", "sfo", "san francisco", "san francisco 49ers", "49ers", "niners"],
  TB: ["tb", "tbb", "tampa bay", "tampa bay buccaneers", "buccaneers", "bucs"],
  TEN: ["ten", "tennessee", "tennessee titans", "titans"],
  WAS: ["was", "wsh", "washington", "washington commanders", "commanders"],
};

function baseNormalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\./g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlayerName(value: string): string {
  const tokens = baseNormalize(value).split(" ").filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  while (tokens.length > 1 && tokens[0].length === 1 && tokens[1].length === 1) {
    tokens.splice(0, 2, `${tokens[0]}${tokens[1]}`);
  }
  return tokens.join(" ");
}

export function normalizeTeam(value: string): string | null {
  const normalized = baseNormalize(value);
  for (const [team, aliases] of Object.entries(TEAM_ALIASES)) {
    if (team.toLowerCase() === normalized || aliases.some((alias) => baseNormalize(alias) === normalized)) {
      return team;
    }
  }
  return null;
}

function defenseTeam(value: string): string | null {
  const withoutDefense = baseNormalize(value)
    .replace(/\b(d st|dst|defense|def)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeTeam(withoutDefense) ?? normalizeTeam(value);
}

export type IdentityResolution =
  | { readonly status: "resolved"; readonly player: Player; readonly matchedBy: "id" | "name" | "alias" | "defense" }
  | { readonly status: "notFound"; readonly normalizedQuery: string }
  | {
      readonly status: "ambiguous";
      readonly normalizedQuery: string;
      readonly candidates: readonly Player[];
    };

export interface ResolveIdentityOptions {
  readonly team?: string;
}

export function resolvePlayerIdentity(
  query: string,
  players: readonly Player[],
  options: ResolveIdentityOptions = {},
): IdentityResolution {
  const directIdMatches = players.filter((player) => player.id === query);
  if (directIdMatches.length === 1) {
    return { status: "resolved", player: directIdMatches[0], matchedBy: "id" };
  }
  if (directIdMatches.length > 1) {
    return {
      status: "ambiguous",
      normalizedQuery: normalizePlayerName(query),
      candidates: directIdMatches,
    };
  }

  const normalizedQuery = normalizePlayerName(query);
  const queryDefenseTeam = defenseTeam(query);
  const contextTeam = options.team ? normalizeTeam(options.team) ?? baseNormalize(options.team).toUpperCase() : null;

  const matches = players
    .map((player) => {
      const normalizedName = normalizePlayerName(player.name);
      const aliases = (player.aliases ?? []).map(normalizePlayerName);
      const playerTeam = normalizeTeam(player.team) ?? player.team.toUpperCase();
      let matchedBy: "name" | "alias" | "defense" | null =
        normalizedName === normalizedQuery
          ? "name"
          : aliases.includes(normalizedQuery)
            ? "alias"
            : player.position === "DEF" && queryDefenseTeam === playerTeam
              ? "defense"
              : null;
      if (contextTeam && playerTeam !== contextTeam) matchedBy = null;
      return matchedBy ? { player, matchedBy } : null;
    })
    .filter((match): match is { player: Player; matchedBy: "name" | "alias" | "defense" } => match !== null);

  if (matches.length === 1) {
    return {
      status: "resolved",
      player: matches[0].player,
      matchedBy: matches[0].matchedBy,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      normalizedQuery,
      candidates: matches.map((match) => match.player),
    };
  }
  return { status: "notFound", normalizedQuery };
}

/** Survives ranking-source swaps; `resolveTrackedPlayerIds` maps it back. */
export function stableTrackId(player: Pick<Player, "name" | "position">): string {
  return `chen:${player.position}:${player.name.toLowerCase()}`;
}

/**
 * Map saved pin/avoid ids onto the current player pool. Chen list swaps and
 * metadata backfill can change a row's id while the name + position stay put.
 */
export function resolveTrackedPlayerIds(
  ids: readonly string[],
  players: readonly Player[],
): string[] {
  const byId = new Map(players.map((player) => [player.id, player.id]));
  const byChen = new Map(
    players.map((player) => [
      `chen:${player.position}:${player.name.toLowerCase()}`,
      player.id,
    ]),
  );
  const byKey = new Map(
    players.map((player) => [
      `${normalizePlayerName(player.name)}|${player.position}`,
      player.id,
    ]),
  );

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const tagged = /^(?:chen|fp):([^:]+):(.+)$/i.exec(id);
    const next =
      byId.get(id) ??
      (tagged
        ? byChen.get(
            `chen:${tagged[1].toUpperCase()}:${tagged[2].toLowerCase()}`,
          ) ??
          byKey.get(
            `${normalizePlayerName(tagged[2])}|${tagged[1].toUpperCase()}`,
          )
        : undefined);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    resolved.push(next);
  }
  return resolved;
}
