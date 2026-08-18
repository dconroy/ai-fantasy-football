import { NextResponse } from "next/server";
import { AuthError, requireActiveUser } from "@/auth/current-user";
import {
  appendSharedPick,
  draftStateFor,
  getOrCreateLeagueDraft,
  listMemberSeats,
  savePicks,
  undoSharedPick,
  userPrefs,
} from "@/persistence/league-draft";
import { opponentPick, simulateToUserTurn } from "@/domain";

export const runtime = "nodejs";

async function payload() {
  const [shared, members, user] = await Promise.all([
    getOrCreateLeagueDraft(),
    listMemberSeats(),
    requireActiveUser(),
  ]);
  const prefs = userPrefs(user);
  return {
    ...shared,
    draft: draftStateFor(shared, prefs.draftSlot),
    members,
    me: { id: user.id, displayName: user.displayName, role: user.role, ...prefs },
  };
}

export async function POST(request: Request) {
  try {
    await requireActiveUser();
    const body = (await request.json().catch(() => null)) as {
      playerId?: string;
      action?: "pick" | "undo" | "advance" | "simulate";
    } | null;

    if (body?.action === "undo") {
      await undoSharedPick();
      return NextResponse.json(await payload());
    }

    if (body?.action === "advance" || body?.action === "simulate") {
      const shared = await getOrCreateLeagueDraft();
      const user = await requireActiveUser();
      const prefs = userPrefs(user);
      const current = draftStateFor(shared, prefs.draftSlot);
      const next =
        body.action === "simulate"
          ? simulateToUserTurn(current, shared.players)
          : opponentPick(current, shared.players);
      if (next.picks.length <= shared.picks.length) {
        return NextResponse.json({ error: "No opponent pick available" }, { status: 409 });
      }
      await savePicks(next.picks);
      return NextResponse.json(await payload());
    }

    if (!body?.playerId) {
      return NextResponse.json({ error: "playerId required" }, { status: 400 });
    }
    await appendSharedPick(body.playerId);
    return NextResponse.json(await payload());
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record pick" },
      { status: 400 },
    );
  }
}
