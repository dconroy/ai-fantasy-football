import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import { requireBoardAccess } from "@/auth/board-access";
import {
  appendSharedPick,
  draftStateFor,
  getOrCreateLeagueDraft,
  savePicks,
  undoSharedPick,
  userPrefs,
} from "@/persistence/league-draft";
import { boardPayload } from "@/persistence/draft-payload";
import { opponentPick, simulateToUserTurn } from "@/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    const body = (await request.json().catch(() => null)) as {
      playerId?: string;
      action?: "pick" | "undo" | "advance" | "simulate";
    } | null;

    if (body?.action === "undo") {
      await undoSharedPick(draftId);
      return NextResponse.json(await boardPayload(draftId, user, demo));
    }

    if (body?.action === "advance" || body?.action === "simulate") {
      if (demo) {
        return NextResponse.json({ error: "Demo rooms are timer-driven" }, { status: 403 });
      }
      const shared = await getOrCreateLeagueDraft(draftId);
      if (!user) throw new AuthError("Authentication required", 401);
      const prefs = userPrefs(user);
      const current = draftStateFor(shared, prefs.draftSlot);
      const next =
        body.action === "simulate"
          ? simulateToUserTurn(current, shared.players)
          : opponentPick(current, shared.players);
      if (next.picks.length <= shared.picks.length) {
        return NextResponse.json({ error: "No opponent pick available" }, { status: 409 });
      }
      await savePicks(next.picks, draftId);
      return NextResponse.json(await boardPayload(draftId, user, demo));
    }

    if (!body?.playerId) {
      return NextResponse.json({ error: "playerId required" }, { status: 400 });
    }
    await appendSharedPick(body.playerId, { draftId });
    return NextResponse.json(await boardPayload(draftId, user, demo));
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
