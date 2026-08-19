import { NextResponse } from "next/server";
import { parseChenScoring } from "@/adapters/chen/boris-chen";
import {
  availableRankingSources,
  fetchRankingImport,
  parseRankingSource,
} from "@/adapters/rankings/sources";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("list") === "sources") {
    return NextResponse.json({ sources: availableRankingSources() });
  }
  const source = parseRankingSource(params.get("source"));
  const scoring = parseChenScoring(params.get("scoring"));
  try {
    const result = await fetchRankingImport(source, scoring);
    if (!result) {
      return NextResponse.json(
        { error: "That ranking source is unavailable." },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load rankings.",
      },
      { status: 502 },
    );
  }
}
