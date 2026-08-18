import { NextRequest, NextResponse } from "next/server";
import { exchangeYahooCode } from "@/adapters/yahoo/oauth";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionTokenFor,
} from "@/auth/current-user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("yahoo_oauth_state")?.value;
  const appUrl = process.env.APP_URL ?? url.origin;

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(`${appUrl}/login?yahoo=denied`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid Yahoo OAuth callback state" }, { status: 400 });
  }

  try {
    const { user } = await exchangeYahooCode(code);
    const destination =
      user.status === "active" ? `${appUrl}/?yahoo=connected` : `${appUrl}/pending`;
    const response = NextResponse.redirect(destination);
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await sessionTokenFor(user),
      sessionCookieOptions(),
    );
    response.cookies.delete("yahoo_oauth_state");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yahoo connection failed";
    return NextResponse.redirect(
      `${appUrl}/login?yahoo=error&message=${encodeURIComponent(message)}`,
    );
  }
}
