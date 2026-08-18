import { NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME } from "@/auth/access";
import { SESSION_COOKIE_NAME } from "@/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
  const response = NextResponse.redirect(new URL("/login", appUrl), 303);
  response.cookies.delete(ACCESS_COOKIE_NAME);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
