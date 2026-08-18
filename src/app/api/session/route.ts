import { NextResponse } from "next/server";
import { AuthError, requireActiveUser } from "@/auth/current-user";
import {
  draftStateFor,
  getOrCreateLeagueDraft,
  listMemberSeats,
  userPrefs,
} from "@/persistence/league-draft";

export const runtime = "nodejs";

/** @deprecated Use /api/draft. Kept so older clients still load the shared board. */
export async function GET() {
  try {
    const [shared, members, user] = await Promise.all([
      getOrCreateLeagueDraft(),
      listMemberSeats(),
      requireActiveUser(),
    ]);
    const prefs = userPrefs(user);
    return NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, prefs.draftSlot),
      members,
      pins: prefs.pins,
      avoids: prefs.avoids,
      weights: prefs.weights,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(null);
  }
}

export async function PUT() {
  return NextResponse.json(
    { error: "Use /api/me for preferences and /api/draft for the shared board" },
    { status: 410 },
  );
}
