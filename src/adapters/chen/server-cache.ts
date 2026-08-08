import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseChenCsv, type ChenImport } from "./boris-chen";

const CACHE_DIRECTORY = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIRECTORY, "chen-ppr.json");

interface CachedImport {
  checksum: string;
  import: ChenImport;
}

export async function readCachedChenImport(): Promise<ChenImport | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return (JSON.parse(raw) as CachedImport).import;
  } catch {
    return null;
  }
}

export async function fetchChenPprImport(): Promise<ChenImport> {
  const url =
    process.env.CHEN_PPR_CSV_URL ??
    "https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-PPR.csv";
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/csv,text/plain;q=0.9" },
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const csv = await response.text();
    const imported = parseChenCsv(csv, url);
    if (imported.players.length === 0) {
      throw new Error("Source contained no usable players");
    }
    await mkdir(CACHE_DIRECTORY, { recursive: true });
    await writeFile(
      CACHE_FILE,
      JSON.stringify(
        {
          checksum: createHash("sha256").update(csv).digest("hex"),
          import: imported,
        } satisfies CachedImport,
        null,
        2,
      ),
      "utf8",
    );
    return imported;
  } catch (error) {
    const cached = await readCachedChenImport();
    if (cached) {
      return {
        ...cached,
        source: `${cached.source} (cached after fetch failure)`,
        warnings: [
          ...cached.warnings,
          error instanceof Error ? error.message : "Chen source unavailable",
        ],
      };
    }
    throw error;
  }
}
