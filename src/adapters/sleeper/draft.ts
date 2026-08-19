import { getSleeperRecords } from "@/adapters/sleeper/players";
import type { YahooSyncSnapshot } from "@/adapters/yahoo/yahoo-api";

const ROOT = "https://api.sleeper.app/v1";

interface SleeperPick {
  player_id?: string;
  pick_no?: number;
  round?: number;
  draft_slot?: number;
}

export async function fetchSleeperSnapshot(
  draftId: string,
): Promise<YahooSyncSnapshot> {
  const [draftResponse, picksResponse, records] = await Promise.all([
    fetch(`${ROOT}/draft/${encodeURIComponent(draftId)}`, { cache: "no-store" }),
    fetch(`${ROOT}/draft/${encodeURIComponent(draftId)}/picks`, {
      cache: "no-store",
    }),
    getSleeperRecords(),
  ]);
  if (!draftResponse.ok) throw new Error("Sleeper draft not found");
  const draft = (await draftResponse.json()) as { draft_id?: string };
  const picks = (await picksResponse.json()) as SleeperPick[];
  const byId = new Map((records ?? []).map((record) => [record.sleeperId, record]));
  return {
    league: draft,
    settings: draft,
    teams: [],
    draftResults: picks
      .filter((pick) => pick.player_id && pick.pick_no)
      .map((pick) => {
        const player = byId.get(String(pick.player_id));
        return {
          pick: Number(pick.pick_no),
          round: Number(pick.round ?? 1),
          teamKey: `sleeper.t.${pick.draft_slot ?? 1}`,
          playerKey: `sleeper.p.${pick.player_id}`,
          playerName: player?.name,
          playerPosition: player?.position,
          playerTeam: player?.team ?? undefined,
        };
      }),
    syncedAt: new Date().toISOString(),
  };
}

export async function lookupSleeperUser(username: string) {
  const response = await fetch(
    `${ROOT}/user/${encodeURIComponent(username)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  const user = (await response.json()) as {
    user_id?: string;
    username?: string;
    display_name?: string;
  } | null;
  if (!user?.user_id) return null;
  const season = String(new Date().getUTCFullYear());
  const [leaguesResponse, draftsResponse] = await Promise.all([
    fetch(`${ROOT}/user/${user.user_id}/leagues/nfl/${season}`, {
      cache: "no-store",
    }),
    fetch(`${ROOT}/user/${user.user_id}/drafts/nfl/${season}`, {
      cache: "no-store",
    }),
  ]);
  const leagues = leaguesResponse.ok
    ? ((await leaguesResponse.json()) as Array<{ league_id: string; name: string }>)
    : [];
  const drafts = draftsResponse.ok
    ? ((await draftsResponse.json()) as Array<{
        draft_id: string;
        type?: string;
        status?: string;
        season?: string;
        league_id?: string;
      }>)
    : [];
  return {
    userId: user.user_id,
    username: user.username ?? username,
    displayName: user.display_name ?? user.username ?? username,
    leagues,
    drafts,
  };
}
