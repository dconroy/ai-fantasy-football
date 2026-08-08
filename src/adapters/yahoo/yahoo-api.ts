import { XMLParser } from "fast-xml-parser";

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

export interface YahooFantasyReadAdapter {
  getLeagueSettings(leagueKey: string): Promise<unknown>;
  getLeagueTeams(leagueKey: string): Promise<unknown>;
  getDraftResults(leagueKey: string): Promise<YahooDraftResult[]>;
  getAvailablePlayers(leagueKey: string, start?: number): Promise<unknown>;
}

function list<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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
      throw new Error(`Yahoo request failed with HTTP ${response.status}`);
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
