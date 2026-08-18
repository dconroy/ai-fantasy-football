import { NextResponse } from "next/server";
import { getYahooConnectionStatus } from "@/adapters/yahoo/oauth";
import { getCurrentUser } from "@/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json(await getYahooConnectionStatus(user));
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : "Unable to read Yahoo status",
      },
      { status: 503 },
    );
  }
}
