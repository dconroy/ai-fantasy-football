import { NextResponse } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import { findOrCreateOpenDemoRoom } from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

function demoMe(slot: number | null, role: "watch" | "play") {
  return {
    id: "demo",
    displayName: role === "play" ? `Seat ${slot}` : "Spectator",
    role: "member" as const,
    draftSlot: slot ?? 1,
    teamName: role === "play" ? `Seat ${slot}` : "Watching",
    pins: [] as string[],
    avoids: [] as string[],
    weights: DEFAULT_STRATEGY_WEIGHTS,
    darkMode: true,
  };
}

export async function GET() {
  try {
    const existing = await getDemoClaims();
    if (existing) {
      const shared = await getOrCreateLeagueDraft(existing.roomId);
      return NextResponse.json({
        ...shared,
        draft: draftStateFor(shared, existing.slot ?? 1),
        members: [],
        me: demoMe(existing.slot, existing.role),
        demo: { role: existing.role, slot: existing.slot, roomId: existing.roomId },
      });
    }
    const { shared } = await findOrCreateOpenDemoRoom();
    const token = await createDemoToken({
      roomId: shared.id,
      slot: null,
      role: "watch",
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, 1),
      members: [],
      me: demoMe(null, "watch"),
      demo: { role: "watch", slot: null, roomId: shared.id },
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to open a demo room" },
      { status: 500 },
    );
  }
}
