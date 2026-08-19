import { NextResponse } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { prisma } from "@/persistence/prisma";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import {
  findOrCreateOpenDemoRoom,
  releaseDemoSeat,
  takenSeatsFor,
  validateDemoSeat,
} from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

function demoMe(slot: number | null, role: "watch" | "play") {
  return {
    id: "demo",
    displayName: role === "play" ? `Seat ${slot}` : "Spectator",
    role: "member" as const,
    draftSlot: slot ?? 0,
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
    const searchParams = new URL(request.url).searchParams;
    const requestedRoom = searchParams.get("room")?.trim() || null;
    const joiningFromInvite = searchParams.get("join") === "1";
    const existing = await getDemoClaims();
    // Resume an existing claim only when no other room was explicitly requested
    // and the claimed room still exists as a real (mock-config) room. An invite
    // always starts at seat selection, even if this browser has a prior claim.
    if (
      !joiningFromInvite &&
      existing &&
      (!requestedRoom || requestedRoom === existing.roomId)
    ) {
      const seatIsValid =
        existing.role === "watch" ||
        (await validateDemoSeat(
          existing.roomId,
          existing.slot,
          existing.sessionId,
        ));
      if (seatIsValid && (await roomIsReal(existing.roomId))) {
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
    if (
      joiningFromInvite &&
      existing?.role === "play" &&
      existing.roomId === requestedRoom
    ) {
      await releaseDemoSeat(
        existing.roomId,
        existing.slot,
        existing.sessionId,
      );
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
      sessionId: null,
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, 0),
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
