import { NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, createAccessToken } from "@/auth/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "App password is not configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || body.password !== expected) {
    return NextResponse.json({ error: "You forgot the magic word." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE_NAME, await createAccessToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
