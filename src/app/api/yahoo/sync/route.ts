import { NextResponse } from "next/server";
import { getValidYahooAccessToken } from "@/adapters/yahoo/oauth";
import { YahooApi } from "@/adapters/yahoo/yahoo-api";
import type { YahooPlayerInfo } from "@/adapters/yahoo/parsers";
import { loadMockSnapshot } from "@/adapters/yahoo/mock-store";
import { fetchSleeperSnapshot } from "@/adapters/sleeper/draft";
import { prisma } from "@/persistence/prisma";

export const runtime = "nodejs";

// Yahoo draft results only carry player keys. Resolve keys to names once and
// remember them for the life of the server process so polling stays cheap.
const playerInfoCache = new Map<string, YahooPlayerInfo>();

async function fetchRealSnapshot(leagueKey: string) {
  const api = new YahooApi(await getValidYahooAccessToken());
  const snapshot = await api.snapshot(leagueKey);
  const unresolvedKeys = [
    ...new Set(
      snapshot.draftResults
        .map((pick) => pick.playerKey)
        .filter((key) => key && !playerInfoCache.has(key)),
    ),
  ];
  if (unresolvedKeys.length > 0) {
    const infos = await api.getPlayersByKeys(leagueKey, unresolvedKeys);
    for (const [key, info] of infos) playerInfoCache.set(key, info);
  }
  return {
    ...snapshot,
    draftResults: snapshot.draftResults.map((pick) => {
      const info = playerInfoCache.get(pick.playerKey);
      return info
        ? {
            ...pick,
            playerName: info.name,
            playerPosition: info.position,
            playerTeam: info.team,
          }
        : pick;
    }),
  };
}

export async function GET(request: Request) {
  const leagueKey =
    new URL(request.url).searchParams.get("leagueKey") ??
    process.env.YAHOO_LEAGUE_KEY;
  if (!leagueKey) {
    return NextResponse.json(
      { error: "YAHOO_LEAGUE_KEY is not configured" },
      { status: 400 },
    );
  }

  try {
    const snapshot = leagueKey.startsWith("mock.")
      ? await loadMockSnapshot(leagueKey)
      : leagueKey.startsWith("sleeper.")
        ? await fetchSleeperSnapshot(leagueKey.slice("sleeper.".length))
        : await fetchRealSnapshot(leagueKey);
    if (!snapshot) {
      return NextResponse.json(
        { error: `No mock draft running for ${leagueKey}` },
        { status: 404 },
      );
    }
    const sequence = snapshot.draftResults.reduce(
      (highest, pick) => Math.max(highest, pick.pick),
      0,
    );
    await Promise.all([
      prisma.syncCheckpoint.upsert({
        where: { id: `yahoo-draft:${leagueKey}` },
        create: {
          id: `yahoo-draft:${leagueKey}`,
          sequence,
          syncedAt: new Date(snapshot.syncedAt),
          payload: JSON.stringify(snapshot.draftResults),
        },
        update: {
          sequence,
          syncedAt: new Date(snapshot.syncedAt),
          payload: JSON.stringify(snapshot.draftResults),
        },
      }),
      prisma.leagueConnection.upsert({
        where: { leagueKey },
        create: {
          leagueKey,
          lastSuccessfulSyncAt: new Date(snapshot.syncedAt),
        },
        update: {
          lastSuccessfulSyncAt: new Date(snapshot.syncedAt),
          lastSyncError: null,
        },
      }),
    ]);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yahoo sync failed";
    await prisma.leagueConnection
      .upsert({
        where: { leagueKey },
        create: { leagueKey, lastSyncError: message },
        update: { lastSyncError: message },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
