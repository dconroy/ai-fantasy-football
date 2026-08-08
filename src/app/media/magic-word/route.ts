import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const audio = await readFile(
    path.join(process.cwd(), "didn't-say-the-magic-word-made-with-Voicemod.mp3"),
  );
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
