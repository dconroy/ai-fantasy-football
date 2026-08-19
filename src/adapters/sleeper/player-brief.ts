import { createHash } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import { normalizePlayerName } from "@/domain/identity";
import { playerMetaKey } from "@/adapters/yahoo/player-meta";
import { getSleeperRecords } from "./players";

const LAST_SEASON = 2025;
const STATS_SOURCE = `sleeper-stats-${LAST_SEASON}`;
const STATS_URL = `https://api.sleeper.app/v1/stats/nfl/regular/${LAST_SEASON}`;
const STATS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ESPN_SEARCH =
  "https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=";

export interface StatChip {
  readonly label: string;
  readonly value: string;
}

export interface PlayerNewsItem {
  readonly title: string;
  readonly url: string;
  readonly published?: string;
}

export interface PlayerBrief {
  readonly season: number;
  readonly stats: readonly StatChip[];
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

async function loadSeasonStats(): Promise<Record<string, RawStats>> {
  try {
    const row = await prisma.dataImport.findFirst({
      where: { source: STATS_SOURCE },
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
    const response = await fetch(STATS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return {};
    const payload = (await response.json()) as Record<string, RawStats>;
    await prisma.dataImport
      .create({
        data: {
          source: STATS_SOURCE,
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
  const [records, stats, news] = await Promise.all([
    getSleeperRecords(),
    loadSeasonStats(),
    loadEspnNews(name),
  ]);

  const key = playerMetaKey(name, position);
  const record = records?.find(
    (entry) => playerMetaKey(entry.name, entry.position) === key,
  ) ?? records?.find(
    (entry) =>
      normalizePlayerName(entry.name) === normalizePlayerName(name) &&
      entry.position === position.toUpperCase(),
  );

  const raw = record ? stats[record.sleeperId] : undefined;
  return {
    season: LAST_SEASON,
    stats: chipsForPosition(position, raw),
    news,
  };
}
