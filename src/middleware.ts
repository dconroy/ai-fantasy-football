import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, validAccessToken } from "@/auth/access";
import { SESSION_COOKIE_NAME, readSessionToken } from "@/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/gate",
  "/api/auth/logout",
  "/api/auth/dev-login",
  "/api/yahoo/callback",
]);

function isPublic(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/media/");
}

function loginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const houseOk = await validAccessToken(
    request.cookies.get(ACCESS_COOKIE_NAME)?.value,
  );
  if (!houseOk) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return loginRedirect(request);
  }

  if (pathname === "/api/yahoo/auth") return NextResponse.next();

  const claims = await readSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!claims) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Yahoo login required" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("step", "yahoo");
    return NextResponse.redirect(loginUrl);
  }

  if (claims.status === "pending") {
    if (pathname === "/api/me" || pathname === "/pending") return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Account is pending approval" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/pending", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
