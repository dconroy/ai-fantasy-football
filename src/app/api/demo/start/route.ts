import { NextResponse, type NextRequest } from "next/server";
import { AuthError } from "@/auth/current-user";
import { requireBoardAccess, requireDemoPlayer } from "@/auth/board-access";
import { boardPayload } from "@/persistence/draft-payload";
import { startDemoDraft } from "@/persistence/demo-rooms";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    await requireDemoPlayer(draftId, demo);
    await startDemoDraft(draftId);
    return NextResponse.json(await boardPayload(draftId, user, demo));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to start the demo draft",
      },
      { status: 400 },
    );
  }
}
