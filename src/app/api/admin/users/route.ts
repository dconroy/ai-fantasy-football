import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import { AuthError, requireAdmin } from "@/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        displayName: true,
        yahooGuid: true,
        role: true,
        status: true,
        draftSlot: true,
        teamName: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to list users" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      status?: "pending" | "active";
      role?: "admin" | "member";
      draftSlot?: number | null;
      teamName?: string | null;
      displayName?: string;
    } | null;
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: body.id },
      data: {
        status: body.status,
        role: body.role,
        draftSlot:
          body.draftSlot === undefined
            ? undefined
            : body.draftSlot === null
              ? null
              : Math.min(12, Math.max(1, Number(body.draftSlot) || 1)),
        teamName: body.teamName === undefined ? undefined : body.teamName,
        displayName: body.displayName?.trim() || undefined,
      },
      select: {
        id: true,
        displayName: true,
        yahooGuid: true,
        role: true,
        status: true,
        draftSlot: true,
        teamName: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ user: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to update user" }, { status: 400 });
  }
}
