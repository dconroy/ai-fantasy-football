import { NextResponse } from "next/server";
import { parseChenScoring } from "@/adapters/chen/boris-chen";
import { fetchChenImport, readCachedChenImport } from "@/adapters/chen/server-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cachedOnly = params.get("cached") === "true";
  const scoring = parseChenScoring(params.get("scoring"));
  try {
    const result = cachedOnly
      ? await readCachedChenImport(scoring)
      : await fetchChenImport(scoring);
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
