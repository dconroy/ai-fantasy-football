import { NextResponse } from "next/server";
import { getValidYahooAccessToken } from "@/adapters/yahoo/oauth";
import { YahooApi } from "@/adapters/yahoo/yahoo-api";
import { requireActiveUser } from "@/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireActiveUser();
    const token = await getValidYahooAccessToken(user);
    const leagues = await new YahooApi(token).getUserNflLeagues();
    return NextResponse.json({ leagues });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list Yahoo leagues";
    return NextResponse.json(
      {
        error: message,
        approvalRequired: message.includes("403"),
      },
      { status: 502 },
    );
  }
}
