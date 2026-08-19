import { NextResponse } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import {
  claimDemoSeat,
  findOrCreateOpenDemoRoom,
} from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

export async function POST() {
  try {
    const existing = await getDemoClaims();
    let roomId = existing?.roomId;
    if (!roomId) {
      roomId = (await findOrCreateOpenDemoRoom()).shared.id;
    }
    let claimed;
    try {
      claimed = await claimDemoSeat(roomId);
    } catch (error) {
      if (!(error instanceof Error) || !/full/i.test(error.message)) throw error;
      roomId = (await findOrCreateOpenDemoRoom()).shared.id;
      claimed = await claimDemoSeat(roomId);
    }
    const shared = await getOrCreateLeagueDraft(claimed.shared.id);
    const token = await createDemoToken({
      roomId: shared.id,
      slot: claimed.slot,
      role: "play",
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, claimed.slot),
      members: [],
      me: {
        id: "demo",
        displayName: `Seat ${claimed.slot}`,
        role: "member",
        draftSlot: claimed.slot,
        teamName: `Seat ${claimed.slot}`,
        pins: [],
        avoids: [],
        weights: DEFAULT_STRATEGY_WEIGHTS,
        darkMode: true,
      },
      demo: { role: "play", slot: claimed.slot, roomId: shared.id },
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to join the demo" },
      { status: 400 },
    );
  }
}
