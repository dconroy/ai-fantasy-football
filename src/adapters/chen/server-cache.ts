import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import {
  CHEN_SCORING,
  DEFAULT_CHEN_SCORING,
  parseChenCsv,
  parseChenScoring,
  type ChenImport,
  type ChenScoring,
} from "./boris-chen";

export async function readCachedChenImport(
  scoring: ChenScoring = DEFAULT_CHEN_SCORING,
): Promise<ChenImport | null> {
  try {
    const cached = await prisma.dataImport.findFirst({
      where: { source: CHEN_SCORING[scoring].cacheSource },
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
  scoring: ChenScoring = DEFAULT_CHEN_SCORING,
): Promise<ChenImport | null> {
  let cachedRow: { payload: string; fetchedAt: Date } | null = null;
  try {
    cachedRow = await prisma.dataImport.findFirst({
      where: { source: CHEN_SCORING[scoring].cacheSource },
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
    return await fetchChenImport(scoring);
  } catch {
    return cachedRow ? (JSON.parse(cachedRow.payload) as ChenImport) : null;
  }
}

export async function fetchChenImport(
  scoring: ChenScoring = DEFAULT_CHEN_SCORING,
): Promise<ChenImport> {
  const format = CHEN_SCORING[scoring];
  try {
    const response = await fetch(format.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "text/csv,text/plain;q=0.9" },
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const csv = await response.text();
    const imported = {
      ...parseChenCsv(csv, `Boris Chen · ${format.label}`),
      scoring,
    };
    if (imported.players.length === 0) {
      throw new Error("Source contained no usable players");
    }
    await prisma.dataImport.create({
      data: {
        source: format.cacheSource,
        playerCount: imported.players.length,
        checksum: createHash("sha256").update(csv).digest("hex"),
        payload: JSON.stringify(imported),
      },
    });
    return imported;
  } catch (error) {
    const cached = await readCachedChenImport(scoring);
    if (cached) {
      return {
        ...cached,
        scoring,
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

/** @deprecated use fetchChenImport */
export async function fetchChenPprImport(): Promise<ChenImport> {
  return fetchChenImport(parseChenScoring("ppr"));
}
