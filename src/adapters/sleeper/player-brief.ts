import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import { normalizePlayerName } from "@/domain/identity";
import { playerMetaKey } from "@/adapters/yahoo/player-meta";
import { getSleeperRecords } from "./players";

export const STAT_SEASONS = [2025, 2024, 2023, 2022] as const;
const STATS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ESPN_SEARCH =
  "https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=";

export interface StatChip {
  readonly label: string;
  readonly value: string;
}

export interface SeasonStatRow {
  readonly year: number;
  readonly stats: readonly StatChip[];
}

export interface PlayerNewsItem {
  readonly title: string;
  readonly url: string;
  readonly published?: string;
}

export interface PlayerBrief {
  readonly seasons: readonly SeasonStatRow[];
  readonly news: readonly PlayerNewsItem[];
}

type RawStats = Record<string, number | undefined>;

function num(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function chipsForPosition(
  position: string,
  raw: RawStats | undefined,
): StatChip[] {
  if (!raw) return [];
  const gp = num(raw.gp);
  switch (position.toUpperCase()) {
    case "QB":
      return [
        { label: "GP", value: gp },
        { label: "Pass yd", value: num(raw.pass_yd) },
        { label: "Pass TD", value: num(raw.pass_td) },
        { label: "INT", value: num(raw.pass_int ?? raw.int) },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
    case "RB":
      return [
        { label: "GP", value: gp },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "Rush TD", value: num(raw.rush_td) },
        { label: "Rec", value: num(raw.rec) },
        { label: "Rec yd", value: num(raw.rec_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
    case "K":
      return [
        { label: "GP", value: gp },
        { label: "FGM", value: num(raw.fgm) },
        { label: "XPM", value: num(raw.xpm) },
        { label: "Pts", value: num(raw.pts_std ?? raw.pts_ppr) },
      ];
    case "DEF":
      return [
        { label: "GP", value: gp },
        { label: "Sacks", value: num(raw.sack) },
        { label: "INT", value: num(raw.int) },
        { label: "FR", value: num(raw.fum_rec) },
        { label: "TD", value: num(raw.td) },
        { label: "Pts", value: num(raw.pts_std ?? raw.pts_ppr) },
      ];
    default:
      return [
        { label: "GP", value: gp },
        { label: "Rec", value: num(raw.rec) },
        { label: "Rec yd", value: num(raw.rec_yd) },
        { label: "Rec TD", value: num(raw.rec_td) },
        { label: "Rush yd", value: num(raw.rush_yd) },
        { label: "PPR", value: num(raw.pts_ppr) },
      ];
  }
}

export function seasonRowsForPosition(
  position: string,
  byYear: ReadonlyArray<{ year: number; raw: RawStats | undefined }>,
): SeasonStatRow[] {
  return byYear
    .map(({ year, raw }) => ({
      year,
      stats: chipsForPosition(position, raw),
    }))
    .filter((row) => row.stats.some((chip) => chip.value !== "—"));
}

function statsSource(year: number) {
  return `sleeper-stats-${year}`;
}

function statsUrl(year: number) {
  return `https://api.sleeper.app/v1/stats/nfl/regular/${year}`;
}

async function loadSeasonStats(year: number): Promise<Record<string, RawStats>> {
  const source = statsSource(year);
  try {
    const row = await prisma.dataImport.findFirst({
      where: { source },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true, fetchedAt: true },
    });
    if (row && Date.now() - row.fetchedAt.getTime() < STATS_MAX_AGE_MS) {
      return JSON.parse(row.payload) as Record<string, RawStats>;
    }
  } catch {
    /* fall through */
  }

  try {
    const response = await fetch(statsUrl(year), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return {};
    const payload = (await response.json()) as Record<string, RawStats>;
    await prisma.dataImport
      .create({
        data: {
          source,
          playerCount: Object.keys(payload).length,
          checksum: createHash("sha256")
            .update(String(Object.keys(payload).length))
            .digest("hex"),
          payload: JSON.stringify(payload),
        },
      })
      .catch(() => undefined);
    return payload;
  } catch {
    return {};
  }
}

async function loadEspnNews(name: string): Promise<PlayerNewsItem[]> {
  try {
    const response = await fetch(`${ESPN_SEARCH}${encodeURIComponent(name)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "ai-fantasy-football/draft-room" },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      results?: Array<{
        type?: string;
        contents?: Array<{
          displayName?: string;
          description?: string;
          published?: string;
          link?: { web?: string };
        }>;
      }>;
    };
    const last = name.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
    const articles =
      body.results?.find((block) => block.type === "article")?.contents ?? [];
    const hits = articles
      .map((article) => ({
        title: article.displayName?.trim() ?? "",
        url: article.link?.web ?? "",
        published: article.published,
      }))
      .filter((item) => item.title && item.url);
    const named = hits.filter((item) => item.title.toLowerCase().includes(last));
    return (named.length > 0 ? named : hits).slice(0, 4);
  } catch {
    return [];
  }
}

export async function loadPlayerBrief(
  name: string,
  position: string,
): Promise<PlayerBrief> {
  const [records, news, ...seasonMaps] = await Promise.all([
    getSleeperRecords(),
    loadEspnNews(name),
    ...STAT_SEASONS.map((year) => loadSeasonStats(year)),
  ]);

  const key = playerMetaKey(name, position);
  const record = records?.find(
    (entry) => playerMetaKey(entry.name, entry.position) === key,
  ) ?? records?.find(
    (entry) =>
      normalizePlayerName(entry.name) === normalizePlayerName(name) &&
      entry.position === position.toUpperCase(),
  );

  const sleeperId = record?.sleeperId;
  return {
    seasons: seasonRowsForPosition(
      position,
      STAT_SEASONS.map((year, index) => ({
        year,
        raw: sleeperId ? seasonMaps[index]?.[sleeperId] : undefined,
      })),
    ),
    news,
  };
}
