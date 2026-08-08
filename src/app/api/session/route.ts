import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";

export const runtime = "nodejs";
const LOCAL_SESSION_ID = "local-simulation";

export async function GET() {
  const session = await prisma.draftSession.findUnique({
    where: { id: LOCAL_SESSION_ID },
  });
  return NextResponse.json(session ? JSON.parse(session.stateJson) : null);
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    draftSlot?: number;
    draft?: { userSlot?: number };
    leagueKey?: string;
    [key: string]: unknown;
  };
  const draftSlot = Math.min(
    12,
    Math.max(1, Number(body.draftSlot ?? body.draft?.userSlot) || 1),
  );
  const session = await prisma.draftSession.upsert({
    where: { id: LOCAL_SESSION_ID },
    create: {
      id: LOCAL_SESSION_ID,
      name: "Local simulation",
      draftSlot,
      leagueKey: typeof body.leagueKey === "string" ? body.leagueKey : null,
      stateJson: JSON.stringify(body),
    },
    update: {
      draftSlot,
      leagueKey: typeof body.leagueKey === "string" ? body.leagueKey : null,
      stateJson: JSON.stringify(body),
    },
  });
  return NextResponse.json({ savedAt: session.updatedAt.toISOString() });
}
