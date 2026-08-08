import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const gif = await readFile(path.join(process.cwd(), "newman.gif"));
  return new Response(gif, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
