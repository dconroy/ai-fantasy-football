import { NextResponse } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { prisma } from "@/persistence/prisma";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import { findOrCreateOpenDemoRoom, takenSeatsFor } from "@/persistence/demo-rooms";
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

async function roomIsReal(roomId: string): Promise<boolean> {
  const row = await prisma.leagueDraft.findUnique({
    where: { id: roomId },
    select: { leagueKey: true },
  });
  return Boolean(row?.leagueKey);
}

export async function GET(request: Request) {
  try {
    const requestedRoom = new URL(request.url).searchParams.get("room")?.trim() || null;
    const existing = await getDemoClaims();
    // Resume an existing claim only when no other room was explicitly requested
    // and the claimed room still exists as a real (mock-config) room.
    if (existing && (!requestedRoom || requestedRoom === existing.roomId)) {
      if (await roomIsReal(existing.roomId)) {
        const shared = await getOrCreateLeagueDraft(existing.roomId);
        return NextResponse.json({
          ...shared,
          draft: draftStateFor(shared, existing.slot ?? 1),
          members: [],
          me: demoMe(existing.slot, existing.role),
          demo: {
            role: existing.role,
            slot: existing.slot,
            roomId: existing.roomId,
            takenSlots: await takenSeatsFor(existing.roomId),
          },
        });
      }
    }
    // Honor an explicit ?room= target when it's a real room; else matchmake.
    const shared =
      requestedRoom && (await roomIsReal(requestedRoom))
        ? await getOrCreateLeagueDraft(requestedRoom)
        : (await findOrCreateOpenDemoRoom()).shared;
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
      demo: {
        role: "watch",
        slot: null,
        roomId: shared.id,
        takenSlots: await takenSeatsFor(shared.id),
      },
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
