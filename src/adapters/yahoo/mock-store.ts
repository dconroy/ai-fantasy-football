import { prisma } from "@/persistence/prisma";
import type { MockDraftConfig } from "./mock-runner";
import { mockDraftResults, recordUserPick } from "./mock-runner";
import type { YahooSyncSnapshot } from "./yahoo-api";

export function checkpointId(leagueKey: string): string {
  return `mock:${leagueKey}`;
}

export async function loadMockConfig(
  leagueKey: string,
): Promise<MockDraftConfig | null> {
  const row = await prisma.syncCheckpoint.findUnique({
    where: { id: checkpointId(leagueKey) },
  });
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as MockDraftConfig;
  } catch {
    return null;
  }
}

export async function saveMockConfig(config: MockDraftConfig): Promise<void> {
  await prisma.syncCheckpoint.upsert({
    where: { id: checkpointId(config.leagueKey) },
    create: {
      id: checkpointId(config.leagueKey),
      sequence: (config.userPicks ?? []).length,
      syncedAt: new Date(),
      payload: JSON.stringify(config),
    },
    update: {
      sequence: (config.userPicks ?? []).length,
      syncedAt: new Date(),
      payload: JSON.stringify(config),
    },
  });
}

export async function appendMockUserPick(
  leagueKey: string,
  playerId: string,
): Promise<MockDraftConfig> {
  const config = await loadMockConfig(leagueKey);
  if (!config) throw new Error(`No mock draft running for ${leagueKey}`);
  const next = recordUserPick(config, playerId);
  await saveMockConfig(next);
  return next;
}

export async function loadMockSnapshot(
  leagueKey: string,
): Promise<YahooSyncSnapshot | null> {
  const config = await loadMockConfig(leagueKey);
  if (!config) return null;
  const { picks, order, total, waitingOnUser } = mockDraftResults(config);
  return {
    league: {
      leagueKey,
      mock: true,
      teamCount: config.teamCount,
      waitingOnUser,
    },
    settings: {
      teamCount: config.teamCount,
      rounds: config.rounds,
      intervalMs: config.intervalMs,
      startedAt: config.startedAtIso,
      totalPicks: total,
      waitingOnUser,
    },
    teams: Array.from({ length: config.teamCount }, (_, index) => ({
      teamKey: `mock.t.${index + 1}`,
      name: index + 1 === config.userSlot ? "Cobra Kai" : `Team ${index + 1}`,
      draftSlot: index + 1,
    })),
    draftResults: picks,
    ...({ mockOrder: order } as unknown as Record<string, unknown>),
    syncedAt: new Date().toISOString(),
  };
}
