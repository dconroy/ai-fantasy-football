import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import { parseChenCsv, type ChenImport } from "./boris-chen";

const CACHE_SOURCE = "boris-chen-ppr";

export async function readCachedChenImport(): Promise<ChenImport | null> {
  try {
    const cached = await prisma.dataImport.findFirst({
      where: { source: CACHE_SOURCE },
      orderBy: { fetchedAt: "desc" },
    });
    return cached ? (JSON.parse(cached.payload) as ChenImport) : null;
  } catch {
    return null;
  }
}

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Returns Chen rankings that are at most `maxAgeMs` old. Serves the DB cache
 * when it is fresh, otherwise fetches live (which also refreshes the cache) and
 * falls back to whatever is cached if the live fetch fails.
 */
export async function getFreshChenImport(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<ChenImport | null> {
  let cachedRow: { payload: string; fetchedAt: Date } | null = null;
  try {
    cachedRow = await prisma.dataImport.findFirst({
      where: { source: CACHE_SOURCE },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true, fetchedAt: true },
    });
  } catch {
    cachedRow = null;
  }
  if (cachedRow && Date.now() - cachedRow.fetchedAt.getTime() < maxAgeMs) {
    try {
      return JSON.parse(cachedRow.payload) as ChenImport;
    } catch {
      // fall through to a live fetch
    }
  }
  try {
    return await fetchChenPprImport();
  } catch {
    return cachedRow ? (JSON.parse(cachedRow.payload) as ChenImport) : null;
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
    await prisma.dataImport.create({
      data: {
        source: CACHE_SOURCE,
        playerCount: imported.players.length,
        checksum: createHash("sha256").update(csv).digest("hex"),
        payload: JSON.stringify(imported),
      },
    });
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
