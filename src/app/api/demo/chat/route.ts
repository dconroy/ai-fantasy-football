import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import {
  requireBoardAccess,
  requireDemoPlayer,
} from "@/auth/board-access";
import {
  createDemoChatMessage,
  DemoChatRateLimitError,
  listDemoChatMessages,
  type DemoChatKind,
} from "@/persistence/demo-chat";
import { demoSeatMembers } from "@/persistence/demo-rooms";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { draftId, demo } = await requireBoardAccess(request);
    if (!demo) throw new AuthError("Demo room access required", 403);
    const after = new URL(request.url).searchParams.get("after");
    return NextResponse.json({
      messages: await listDemoChatMessages(draftId, after),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load chat" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { draftId, demo } = await requireBoardAccess(request);
    const player = await requireDemoPlayer(draftId, demo);
    const body = (await request.json().catch(() => null)) as {
      kind?: DemoChatKind;
      content?: unknown;
      gifUrl?: unknown;
      gifAlt?: unknown;
    } | null;
    if (!body) throw new Error("Message is required");
    const member = (await demoSeatMembers(draftId)).find(
      (candidate) => candidate.draftSlot === player.slot,
    );
    if (!member || !player.slot) {
      throw new AuthError("Your demo seat expired or was reclaimed", 401);
    }
    const message = await createDemoChatMessage({
      roomId: draftId,
      authorName: member.teamName || member.displayName,
      authorSlot: player.slot,
      kind: body.kind === "gif" ? "gif" : "text",
      content: body.content,
      gifUrl: body.gifUrl,
      gifAlt: body.gifAlt,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof DemoChatRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send message" },
      { status: 400 },
    );
  }
}
