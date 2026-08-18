import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  AuthError,
  SESSION_COOKIE_NAME,
  getCurrentUser,
  sessionCookieOptions,
  sessionTokenFor,
} from "@/auth/current-user";
import { userPrefs } from "@/persistence/league-draft";
import type { StrategyWeights } from "@/domain";

export const runtime = "nodejs";

function toMe(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const prefs = userPrefs(user);
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    yahooGuid: user.yahooGuid,
    ...prefs,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const response = NextResponse.json(toMe(user));
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await sessionTokenFor(user),
    sessionCookieOptions(),
  );
  return response;
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Authentication required", 401);
    if (user.status !== "active") throw new AuthError("Account is pending approval", 403);

    const body = (await request.json().catch(() => null)) as {
      draftSlot?: number;
      teamName?: string;
      pins?: string[];
      avoids?: string[];
      weights?: Partial<StrategyWeights>;
      darkMode?: boolean;
      displayName?: string;
    } | null;

    const draftSlot =
      body?.draftSlot === undefined
        ? user.draftSlot
        : Math.min(12, Math.max(1, Number(body.draftSlot) || 1));
    const weights = body?.weights
      ? { ...DEFAULT_STRATEGY_WEIGHTS, ...body.weights }
      : undefined;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        draftSlot,
        teamName: body?.teamName?.trim() || user.teamName,
        displayName: body?.displayName?.trim() || user.displayName,
        pinsJson: Array.isArray(body?.pins) ? JSON.stringify(body.pins) : undefined,
        avoidsJson: Array.isArray(body?.avoids) ? JSON.stringify(body.avoids) : undefined,
        weightsJson: weights ? JSON.stringify(weights) : undefined,
        darkMode: typeof body?.darkMode === "boolean" ? body.darkMode : undefined,
      },
    });
    return NextResponse.json(toMe(updated));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to save preferences" }, { status: 500 });
  }
}
