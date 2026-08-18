/**
 * Pure parsing helpers for Yahoo Fantasy XML responses (already parsed to
 * objects by fast-xml-parser). Kept free of I/O so they can be unit tested
 * with recorded fixtures.
 */

export interface YahooTeamInfo {
  teamKey: string;
  name: string;
  isMine: boolean;
  managerNickname?: string;
}

export interface YahooRosterPlayer {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  selectedPosition: string;
  status?: string;
  statusFull?: string;
  injuryNote?: string;
  byeWeek?: number;
}

export interface YahooStandingsRow {
  rank: number;
  teamKey: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface YahooMatchupTeam {
  teamKey: string;
  name: string;
  points?: number;
  projectedPoints?: number;
}

export interface YahooMatchup {
  week?: number;
  status?: string;
  teams: YahooMatchupTeam[];
}

export interface YahooTransactionPlayer {
  name: string;
  position?: string;
  team?: string;
  moveType: string;
  sourceTeamName?: string;
  destinationTeamName?: string;
}

export interface YahooTransaction {
  key: string;
  type: string;
  status?: string;
  timestamp?: number;
  players: YahooTransactionPlayer[];
}

export interface YahooFreeAgent {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  status?: string;
  byeWeek?: number;
  percentOwned?: number;
}

export interface YahooPlayerInfo {
  playerKey: string;
  name: string;
  position: string;
  team: string;
}

export interface YahooLeagueMeta {
  name: string;
  currentWeek?: number;
  /** Position label (QB, RB, W/R/T, BN, IR, DEF…) to slot count. */
  rosterSlots: Record<string, number>;
}

type Raw = Record<string, unknown>;

export function list<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function get(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Raw)[key];
  }
  return current;
}

function playerName(player: Raw): string {
  const name = player.name;
  if (typeof name === "object" && name !== null) {
    return str((name as Raw).full);
  }
  return str(name);
}

function playerTeamAbbr(player: Raw): string {
  return str(player.editorial_team_abbr).toUpperCase();
}

function playerByeWeek(player: Raw): number | undefined {
  return num(get(player, "bye_weeks", "week"));
}

export function parseTeams(body: unknown): YahooTeamInfo[] {
  const teams = list<Raw>(
    get(body, "fantasy_content", "league", "teams", "team") as Raw | Raw[],
  );
  return teams
    .map((team) => ({
      teamKey: str(team.team_key),
      name: str(team.name),
      isMine: num(team.is_owned_by_current_login) === 1,
      managerNickname:
        str(get(team, "managers", "manager", "nickname")) || undefined,
    }))
    .filter((team) => team.teamKey.length > 0);
}

export function parseRoster(body: unknown): YahooRosterPlayer[] {
  const players = list<Raw>(
    get(body, "fantasy_content", "team", "roster", "players", "player") as
      | Raw
      | Raw[],
  );
  return players
    .map((player) => ({
      playerKey: str(player.player_key),
      name: playerName(player),
      position: str(player.display_position || player.primary_position),
      team: playerTeamAbbr(player),
      selectedPosition: str(get(player, "selected_position", "position")),
      status: str(player.status) || undefined,
      statusFull: str(player.status_full) || undefined,
      injuryNote: str(player.injury_note) || undefined,
      byeWeek: playerByeWeek(player),
    }))
    .filter((player) => player.playerKey.length > 0);
}

export function parseStandings(body: unknown): YahooStandingsRow[] {
  const teams = list<Raw>(
    get(body, "fantasy_content", "league", "standings", "teams", "team") as
      | Raw
      | Raw[],
  );
  return teams
    .map((team) => {
      const standings = (team.team_standings ?? {}) as Raw;
      const outcomes = (standings.outcome_totals ?? {}) as Raw;
      return {
        rank: num(standings.rank) ?? 0,
        teamKey: str(team.team_key),
        name: str(team.name),
        wins: num(outcomes.wins) ?? 0,
        losses: num(outcomes.losses) ?? 0,
        ties: num(outcomes.ties) ?? 0,
        pointsFor:
          num(standings.points_for) ?? num(get(team, "team_points", "total")) ?? 0,
        pointsAgainst: num(standings.points_against) ?? 0,
      };
    })
    .filter((row) => row.teamKey.length > 0)
    .sort((a, b) => (a.rank || 99) - (b.rank || 99));
}

export function parseScoreboard(body: unknown): YahooMatchup[] {
  const matchups = list<Raw>(
    get(body, "fantasy_content", "league", "scoreboard", "matchups", "matchup") as
      | Raw
      | Raw[],
  );
  return matchups.map((matchup) => ({
    week: num(matchup.week),
    status: str(matchup.status) || undefined,
    teams: list<Raw>(get(matchup, "teams", "team") as Raw | Raw[]).map((team) => ({
      teamKey: str(team.team_key),
      name: str(team.name),
      points: num(get(team, "team_points", "total")),
      projectedPoints: num(get(team, "team_projected_points", "total")),
    })),
  }));
}

export function parseTransactions(body: unknown): YahooTransaction[] {
  const transactions = list<Raw>(
    get(body, "fantasy_content", "league", "transactions", "transaction") as
      | Raw
      | Raw[],
  );
  return transactions
    .map((transaction) => ({
      key: str(transaction.transaction_key),
      type: str(transaction.type),
      status: str(transaction.status) || undefined,
      timestamp: num(transaction.timestamp),
      players: list<Raw>(get(transaction, "players", "player") as Raw | Raw[]).map(
        (player) => {
          const data = list<Raw>(player.transaction_data as Raw | Raw[])[0] ?? {};
          return {
            name: playerName(player),
            position: str(player.display_position) || undefined,
            team: playerTeamAbbr(player) || undefined,
            moveType: str(data.type),
            sourceTeamName: str(data.source_team_name) || undefined,
            destinationTeamName: str(data.destination_team_name) || undefined,
          };
        },
      ),
    }))
    .filter((transaction) => transaction.key.length > 0);
}

export function parseLeaguePlayers(body: unknown): YahooFreeAgent[] {
  const players = list<Raw>(
    get(body, "fantasy_content", "league", "players", "player") as Raw | Raw[],
  );
  return players
    .map((player) => ({
      playerKey: str(player.player_key),
      name: playerName(player),
      position: str(player.display_position || player.primary_position),
      team: playerTeamAbbr(player),
      status: str(player.status) || undefined,
      byeWeek: playerByeWeek(player),
      percentOwned: num(get(player, "percent_owned", "value")),
    }))
    .filter((player) => player.playerKey.length > 0);
}

export function parsePlayerInfos(body: unknown): YahooPlayerInfo[] {
  return parseLeaguePlayers(body).map((player) => ({
    playerKey: player.playerKey,
    name: player.name,
    position: player.position,
    team: player.team,
  }));
}

export function parseLeagueMeta(body: unknown): YahooLeagueMeta {
  const league = (get(body, "fantasy_content", "league") ?? {}) as Raw;
  const positions = list<Raw>(
    get(league, "settings", "roster_positions", "roster_position") as Raw | Raw[],
  );
  const rosterSlots: Record<string, number> = {};
  for (const entry of positions) {
    const label = str(entry.position);
    const count = num(entry.count) ?? 0;
    if (label) rosterSlots[label] = (rosterSlots[label] ?? 0) + count;
  }
  return {
    name: str(league.name),
    currentWeek: num(league.current_week),
    rosterSlots,
  };
}
