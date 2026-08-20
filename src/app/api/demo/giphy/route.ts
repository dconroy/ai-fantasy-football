import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import { requireBoardAccess } from "@/auth/board-access";

export const runtime = "nodejs";

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyResult {
  id?: string;
  title?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_small?: GiphyImage;
    original?: GiphyImage;
  };
}

export async function GET(request: Request) {
  try {
    const { demo } = await requireBoardAccess(request);
    if (!demo) throw new AuthError("Demo room access required", 403);
    const key = process.env.GIPHY_API_KEY?.trim();
    if (!key) {
      return NextResponse.json(
        { error: "GIF search is not configured" },
        { status: 503 },
      );
    }
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 50);
    if (!query || query.length < 2) {
      return NextResponse.json({ gifs: [] });
    }
    const params = new URLSearchParams({
      api_key: key,
      q: query,
      limit: "18",
      lang: "en",
    });
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/search?${params}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            response.status === 429
              ? "GIPHY search is busy. Try again shortly."
              : "GIPHY search is unavailable",
        },
        { status: response.status === 429 ? 429 : 502 },
      );
    }
    const body = (await response.json()) as { data?: GiphyResult[] };
    const gifs = (body.data ?? [])
      .map((gif) => {
        const image = gif.images?.fixed_height ?? gif.images?.original;
        const preview = gif.images?.fixed_height_small ?? image;
        if (!gif.id || !image?.url || !preview?.url) return null;
        return {
          id: gif.id,
          title: gif.title?.trim() || "GIPHY GIF",
          url: image.url,
          previewUrl: preview.url,
          width: Number(image.width) || 200,
          height: Number(image.height) || 200,
        };
      })
      .filter(Boolean);
    return NextResponse.json({ gifs });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to search GIFs" }, { status: 500 });
  }
}
