import { NextResponse } from "next/server";
import { listDemoRooms } from "@/persistence/demo-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const all = await listDemoRooms();
    // Rooms someone can still join: not complete and at least one open seat.
    const joinable = all.filter((room) => !room.complete && room.openSeats > 0);
    const totalOpenSeats = joinable.reduce((sum, room) => sum + room.openSeats, 0);
    const activePlayers = all.reduce((sum, room) => sum + room.activeSeats, 0);
    return NextResponse.json({
      totalRooms: all.length,
      joinableRooms: joinable.length,
      totalOpenSeats,
      activePlayers,
      rooms: joinable.map((room, index) => ({
        id: room.id,
        name: `Room ${index + 1}`,
        totalSeats: room.totalSeats,
        activeSeats: room.activeSeats,
        openSeats: room.openSeats,
        picks: room.picks,
        totalPicks: room.totalPicks,
        started: room.started,
      })),
    });
  } catch {
    return NextResponse.json(
      { totalRooms: 0, joinableRooms: 0, totalOpenSeats: 0, activePlayers: 0, rooms: [] },
      { status: 200 },
    );
  }
}
