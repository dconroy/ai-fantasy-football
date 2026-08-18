import { XMLParser } from "fast-xml-parser";
import {
  list,
  parseLeagueMeta,
  parseLeaguePlayers,
  parsePlayerInfos,
  parseRoster,
  parseScoreboard,
  parseStandings,
  parseTeams,
  parseTransactions,
  type YahooFreeAgent,
  type YahooLeagueMeta,
  type YahooMatchup,
  type YahooPlayerInfo,
  type YahooRosterPlayer,
  type YahooStandingsRow,
  type YahooTeamInfo,
  type YahooTransaction,
} from "./parsers";

const API_ROOT = "https://fantasysports.yahooapis.com/fantasy/v2";

export interface YahooDraftResult {
  pick: number;
  round: number;
  teamKey: string;
  playerKey: string;
  cost?: number;
}

export interface YahooSyncSnapshot {
  league: unknown;
  settings: unknown;
  teams: unknown;
  draftResults: YahooDraftResult[];
  syncedAt: string;
}

export interface YahooLeagueSummary {
  leagueKey: string;
  leagueId: string;
  name: string;
  season?: number;
  currentWeek?: number;
  numTeams?: number;
  scoringType?: string;
  draftStatus?: string;
}

export interface YahooFantasyReadAdapter {
  getLeagueSettings(leagueKey: string): Promise<unknown>;
  getLeagueTeams(leagueKey: string): Promise<unknown>;
  getDraftResults(leagueKey: string): Promise<YahooDraftResult[]>;
  getAvailablePlayers(leagueKey: string, start?: number): Promise<unknown>;
  getUserNflLeagues(): Promise<YahooLeagueSummary[]>;
}

export class YahooApi implements YahooFantasyReadAdapter {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
  });

  constructor(private readonly accessToken: string) {}

  private async get(pathname: string) {
    const response = await fetch(`${API_ROOT}${pathname}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/xml",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (body.includes("additional_authorization_required")) {
        throw new Error(
          "Yahoo hasn't approved this app for Fantasy Sports API access yet. " +
            "Check your application status at sports.yahoo.com/developer — " +
            "sign in with Yahoo again once it's approved.",
        );
      }
      const description = /<yahoo:description>([^<]+)</.exec(body)?.[1];
      throw new Error(
        description
          ? `Yahoo error: ${description.trim()}`
          : `Yahoo request failed with HTTP ${response.status}`,
      );
    }
    return this.parser.parse(await response.text());
  }

  getLeagueSettings(leagueKey: string) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/settings`);
  }

  getLeagueTeams(leagueKey: string) {
    return this.get(`/league/${encodeURIComponent(leagueKey)}/teams`);
  }

  async getDraftResults(leagueKey: string): Promise<YahooDraftResult[]> {
    const body = await this.get(
      `/league/${encodeURIComponent(leagueKey)}/draftresults`,
    );
    const collection =
      body?.fantasy_content?.league?.draft_results?.draft_result;
    return list<Record<string, string | number>>(collection)
      .map((item) => ({
        pick: Number(item.pick),
        round: Number(item.round),
        teamKey: String(item.team_key),
        playerKey: String(item.player_key),
        cost: item.cost === undefined ? undefined : Number(item.cost),
      }))
      .filter(
        (pick) =>
          Number.isFinite(pick.pick) &&
          Number.isFinite(pick.round) &&
          pick.playerKey !== "undefined",
      );
  }

  getAvailablePlayers(leagueKey: string, start = 0) {
    // Yahoo documents status=A for available players. ADP is not assumed.
    return this.get(
      `/league/${encodeURIComponent(leagueKey)}/players;status=A;sort=OR;start=${start}`,
    );
  }

  async getUserNflLeagues(): Promise<YahooLeagueSummary[]> {
    const body = await this.get(
      "/users;use_login=1/games;game_codes=nfl/leagues",
    );
    const users = list<Record<string, unknown>>(body?.fantasy_content?.users?.user);
    const games = users.flatMap((user) =>
      list<Record<string, unknown>>(
        (user as { games?: { game?: Record<string, unknown> | Record<string, unknown>[] } })
          .games?.game,
      ),
    );
    const leagues = games.flatMap((game) =>
      list<Record<string, string | number>>(
        (
          game as {
            leagues?: {
              league?: Record<string, string | number> | Record<string, string | number>[];
            };
          }
        ).leagues?.league,
      ),
    );
    return leagues
      .map((league) => ({
        leagueKey: String(league.league_key ?? ""),
        leagueId: String(league.league_id ?? ""),
        name: String(league.name ?? "Yahoo league"),
        season: league.season === undefined ? undefined : Number(league.season),
        currentWeek:
          league.current_week === undefined ? undefined : Number(league.current_week),
        numTeams: league.num_teams === undefined ? undefined : Number(league.num_teams),
        scoringType:
          league.scoring_type === undefined ? undefined : String(league.scoring_type),
        draftStatus:
          league.draft_status === undefined ? undefined : String(league.draft_status),
      }))
      .filter((league) => league.leagueKey.length > 0);
  }

  async getTeams(leagueKey: string): Promise<YahooTeamInfo[]> {
    return parseTeams(
      await this.get(`/league/${encodeURIComponent(leagueKey)}/teams`),
    );
  }

  async getRoster(teamKey: string, week?: number): Promise<YahooRosterPlayer[]> {
    const weekParam = week ? `;week=${week}` : "";
    return parseRoster(
      await this.get(`/team/${encodeURIComponent(teamKey)}/roster${weekParam}`),
    );
  }

  async getLeagueMeta(leagueKey: string): Promise<YahooLeagueMeta> {
    return parseLeagueMeta(
      await this.get(`/league/${encodeURIComponent(leagueKey)}/settings`),
    );
  }

  async getStandings(leagueKey: string): Promise<YahooStandingsRow[]> {
    return parseStandings(
      await this.get(`/league/${encodeURIComponent(leagueKey)}/standings`),
    );
  }

  async getScoreboard(leagueKey: string, week?: number): Promise<YahooMatchup[]> {
    const weekParam = week ? `;week=${week}` : "";
    return parseScoreboard(
      await this.get(
        `/league/${encodeURIComponent(leagueKey)}/scoreboard${weekParam}`,
      ),
    );
  }

  async getTransactions(
    leagueKey: string,
    count = 15,
  ): Promise<YahooTransaction[]> {
    return parseTransactions(
      await this.get(
        `/league/${encodeURIComponent(leagueKey)}/transactions;count=${count}`,
      ),
    );
  }

  async getFreeAgents(
    leagueKey: string,
    options: { position?: string; count?: number; sort?: "AR" | "OR" } = {},
  ): Promise<YahooFreeAgent[]> {
    const position = options.position ? `;position=${options.position}` : "";
    const count = options.count ?? 25;
    const league = encodeURIComponent(leagueKey);
    const build = (sort: string) =>
      `/league/${league}/players;status=FA${position};sort=${sort};count=${count}/percent_owned`;
    try {
      return parseLeaguePlayers(await this.get(build(options.sort ?? "AR")));
    } catch {
      // Actual-rank sort can fail before any games are played; fall back to
      // Yahoo's overall pre-season rank.
      return parseLeaguePlayers(await this.get(build("OR")));
    }
  }

  /** Resolve Yahoo player keys to names/teams, batched 25 keys per request. */
  async getPlayersByKeys(
    leagueKey: string,
    playerKeys: readonly string[],
  ): Promise<Map<string, YahooPlayerInfo>> {
    const resolved = new Map<string, YahooPlayerInfo>();
    for (let start = 0; start < playerKeys.length; start += 25) {
      const batch = playerKeys.slice(start, start + 25);
      const body = await this.get(
        `/league/${encodeURIComponent(leagueKey)}/players;player_keys=${batch
          .map(encodeURIComponent)
          .join(",")}`,
      );
      for (const info of parsePlayerInfos(body)) {
        resolved.set(info.playerKey, info);
      }
    }
    return resolved;
  }

  async snapshot(leagueKey: string): Promise<YahooSyncSnapshot> {
    const [settings, teams, draftResults] = await Promise.all([
      this.getLeagueSettings(leagueKey),
      this.getLeagueTeams(leagueKey),
      this.getDraftResults(leagueKey),
    ]);
    return {
      league: { leagueKey },
      settings,
      teams,
      draftResults,
      syncedAt: new Date().toISOString(),
    };
  }
}

// Intentionally no makePick method: Yahoo does not document a live-draft
// selection operation in the Fantasy Sports API.
