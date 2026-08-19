import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createYahooAuthorizationUrl } from "@/adapters/yahoo/oauth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = randomBytes(24).toString("base64url");
    const response = NextResponse.redirect(createYahooAuthorizationUrl(state));
    response.cookies.set("yahoo_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Yahoo OAuth is unavailable" },
      { status: 503 },
    );
  }
}
