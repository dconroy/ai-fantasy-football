import { NextRequest, NextResponse } from "next/server";
import { exchangeYahooCode } from "@/adapters/yahoo/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("yahoo_oauth_state")?.value;
  const appUrl = process.env.APP_URL ?? url.origin;

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(`${appUrl}/?yahoo=denied`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid Yahoo OAuth callback state" }, { status: 400 });
  }

  try {
    await exchangeYahooCode(code);
    const response = NextResponse.redirect(`${appUrl}/?yahoo=connected`);
    response.cookies.delete("yahoo_oauth_state");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yahoo connection failed";
    return NextResponse.redirect(
      `${appUrl}/?yahoo=error&message=${encodeURIComponent(message)}`,
    );
  }
}
