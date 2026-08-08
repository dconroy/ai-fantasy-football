import { NextResponse } from "next/server";
import { getValidYahooAccessToken } from "@/adapters/yahoo/oauth";
import { YahooApi } from "@/adapters/yahoo/yahoo-api";
import { prisma } from "@/persistence/prisma";

export const runtime = "nodejs";

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
    const token = await getValidYahooAccessToken();
    const snapshot = await new YahooApi(token).snapshot(leagueKey);
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
