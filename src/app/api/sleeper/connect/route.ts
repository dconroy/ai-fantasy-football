import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import { lookupSleeperUser } from "@/adapters/sleeper/draft";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionTokenFor,
} from "@/auth/current-user";
import {
  getOrCreateLeagueDraft,
  resetSharedDraft,
  saveSharedDraft,
} from "@/persistence/league-draft";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    userId?: string;
    displayName?: string;
    draftId?: string;
    leagueId?: string;
  } | null;

  if (!body?.draftId) {
    const username = body?.username?.trim();
    if (!username) {
      return NextResponse.json({ error: "Sleeper username required" }, { status: 400 });
    }
    const found = await lookupSleeperUser(username);
    if (!found) {
      return NextResponse.json({ error: "Sleeper user not found" }, { status: 404 });
    }
    return NextResponse.json(found);
  }

  const userId = body.userId?.trim();
  const username = body.username?.trim();
  if (!userId || !username) {
    return NextResponse.json({ error: "Sleeper user id required" }, { status: 400 });
  }

  const yahooGuid = `sleeper:${userId}`;
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const user = await prisma.user.upsert({
    where: { yahooGuid },
    create: {
      yahooGuid,
      displayName: body.displayName?.trim() || username,
      role: "member",
      status: "active",
      encryptedAccessToken: "sleeper.none.none",
      encryptedRefreshToken: "sleeper.none.none",
      expiresAt,
      sleeperUsername: username,
      sleeperLeagueId: body.leagueId ?? null,
      sleeperDraftId: body.draftId,
    },
    update: {
      displayName: body.displayName?.trim() || username,
      status: "active",
      sleeperUsername: username,
      sleeperLeagueId: body.leagueId ?? null,
      sleeperDraftId: body.draftId,
    },
  });

  const draftRowId = `sleeper:${body.draftId}`;
  const leagueKey = `sleeper.${body.draftId}`;
  await getOrCreateLeagueDraft(draftRowId);
  const existing = await getOrCreateLeagueDraft(draftRowId);
  if (existing.picks.length === 0 || existing.leagueKey !== leagueKey) {
    await resetSharedDraft("live", leagueKey, draftRowId);
    await saveSharedDraft({ draftId: draftRowId, mode: "live", leagueKey });
  }

  const response = NextResponse.json({
    ok: true,
    boardId: draftRowId,
    user: { id: user.id, displayName: user.displayName },
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await sessionTokenFor(user),
    sessionCookieOptions(),
  );
  return response;
}
