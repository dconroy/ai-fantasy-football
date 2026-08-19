import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { prisma } from "@/persistence/prisma";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import { restartDemoRoom, takenSeatsFor } from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

async function roomIsReal(roomId: string): Promise<boolean> {
  const room = await prisma.leagueDraft.findUnique({
    where: { id: roomId },
    select: { leagueKey: true },
  });
  return Boolean(room?.leagueKey);
}

export async function POST(request: NextRequest) {
  try {
    const existing = await getDemoClaims();
    if (!existing?.roomId || !(await roomIsReal(existing.roomId))) {
      return NextResponse.json(
        { error: "Join a demo room before restarting it." },
        { status: 400 },
      );
    }

    const { shared, slot } = await restartDemoRoom(
      existing.roomId,
      existing.slot ?? null,
    );
    const role = slot ? "play" : "watch";
    const token = await createDemoToken({
      roomId: shared.id,
      slot: slot ?? null,
      role,
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, slot ?? 1),
      members: [],
      me: {
        id: "demo",
        displayName: role === "play" ? `Seat ${slot}` : "Spectator",
        role: "member",
        draftSlot: slot ?? 1,
        teamName: role === "play" ? `Seat ${slot}` : "Watching",
        pins: [],
        avoids: [],
        weights: DEFAULT_STRATEGY_WEIGHTS,
        darkMode: true,
      },
      demo: {
        role,
        slot: slot ?? null,
        roomId: shared.id,
        takenSlots: await takenSeatsFor(shared.id),
      },
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to restart the demo" },
      { status: 400 },
    );
  }
}
