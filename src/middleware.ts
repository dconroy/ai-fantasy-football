import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, validAccessToken } from "@/auth/access";

export async function middleware(request: NextRequest) {
  if (!process.env.APP_ACCESS_PASSWORD) return NextResponse.next();

  // Yahoo must be able to deliver the one-time authorization code directly.
  if (
    request.nextUrl.pathname === "/api/yahoo/callback" ||
    request.nextUrl.pathname === "/api/auth/login" ||
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/media/")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (await validAccessToken(token)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
