import { NextResponse } from "next/server";
import { getYahooConnectionStatus } from "@/adapters/yahoo/oauth";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getYahooConnectionStatus());
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
