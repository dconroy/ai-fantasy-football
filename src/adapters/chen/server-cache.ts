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
