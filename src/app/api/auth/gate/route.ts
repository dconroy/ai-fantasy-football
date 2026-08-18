import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, validAccessToken } from "@/auth/access";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  const house = await validAccessToken(jar.get(ACCESS_COOKIE_NAME)?.value);
  return NextResponse.json({ house });
}
