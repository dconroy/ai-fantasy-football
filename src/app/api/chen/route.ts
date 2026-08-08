import { NextResponse } from "next/server";
import { fetchChenPprImport, readCachedChenImport } from "@/adapters/chen/server-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cachedOnly = new URL(request.url).searchParams.get("cached") === "true";
  try {
    const result = cachedOnly
      ? await readCachedChenImport()
      : await fetchChenPprImport();
    if (!result) {
      return NextResponse.json(
        { error: "No cached Chen import is available." },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Boris Chen data.",
      },
      { status: 502 },
    );
  }
}
