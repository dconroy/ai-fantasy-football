import { NextResponse } from "next/server";
import { AuthError, requireActiveUser } from "@/auth/current-user";
import {
  ConflictError,
  draftStateFor,
  getOrCreateLeagueDraft,
  listMemberSeats,
  replacePlayers,
  resetSharedDraft,
  saveSharedDraft,
  touchLastSeen,
  userPrefs,
} from "@/persistence/league-draft";
import type { DraftState, Player } from "@/domain";

export const runtime = "nodejs";

async function payload() {
  const user = await requireActiveUser();
  await touchLastSeen(user);
  const [shared, members] = await Promise.all([
    getOrCreateLeagueDraft(),
    listMemberSeats(),
  ]);
  const prefs = userPrefs(user);
  return {
    ...shared,
    draft: draftStateFor(shared, prefs.draftSlot),
    members,
    me: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      ...prefs,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await payload());
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load draft" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireActiveUser();
    const body = (await request.json().catch(() => null)) as {
      action?: "reset" | "players" | "leagueKey" | "picks";
      mode?: "mock" | "live";
      leagueKey?: string | null;
      players?: Player[];
      picks?: DraftState["picks"];
      importedAt?: string;
      source?: string;
      expectedUpdatedAt?: string;
    } | null;

    if (body?.action === "reset") {
      await resetSharedDraft(
        body.mode === "live" ? "live" : "mock",
        body.leagueKey,
      );
    } else if (body?.action === "players" && Array.isArray(body.players)) {
      await replacePlayers(
        body.players,
        body.source ?? "Imported",
        body.importedAt ?? new Date().toISOString(),
      );
    } else if (body?.action === "leagueKey") {
      await saveSharedDraft({
        leagueKey: body.leagueKey ?? null,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    } else if (body?.action === "picks" && Array.isArray(body.picks)) {
      const current = await getOrCreateLeagueDraft();
      if (body.picks.length < current.picks.length) {
        return NextResponse.json(
          { error: "Refusing to shrink the shared board" },
          { status: 409 },
        );
      }
      await saveSharedDraft({
        picks: body.picks,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    } else if (body?.mode) {
      await saveSharedDraft({
        mode: body.mode,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    }

    return NextResponse.json(await payload());
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update draft" }, { status: 500 });
  }
}
