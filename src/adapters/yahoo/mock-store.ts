import { prisma } from "@/persistence/prisma";
import type { MockDraftConfig } from "./mock-runner";
import {
  autoPickDeadline,
  autoPickIfDue,
  humanPickCount,
  mockDraftResults,
  recordUserPick,
} from "./mock-runner";
import type { YahooSyncSnapshot } from "./yahoo-api";

function humanSlotSet(config: MockDraftConfig): Set<number> {
  if (config.humanSlots && config.humanSlots.length > 0) {
    return new Set(config.humanSlots);
  }
  return new Set([config.userSlot ?? 1]);
}

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
  const sequence = humanPickCount(config);
  await prisma.syncCheckpoint.upsert({
    where: { id: checkpointId(config.leagueKey) },
    create: {
      id: checkpointId(config.leagueKey),
      sequence,
      syncedAt: new Date(),
      payload: JSON.stringify(config),
    },
    update: {
      sequence,
      syncedAt: new Date(),
      payload: JSON.stringify(config),
    },
  });
}

export async function appendMockUserPick(
  leagueKey: string,
  playerId: string,
  expectedSlot?: number,
): Promise<MockDraftConfig> {
  const config = await loadMockConfig(leagueKey);
  if (!config) throw new Error(`No mock draft running for ${leagueKey}`);
  const next = recordUserPick(config, playerId, Date.now(), expectedSlot);
  await saveMockConfig(next);
  return next;
}

/**
 * Auto-draft the best available player for any human seat that has been on the
 * clock past its deadline, advancing the mock without a human confirm. Applies
 * as many overdue picks as are due (e.g. after nobody polled for a while).
 *
 * Uses a compare-and-set on the checkpoint `sequence` so concurrent pollers
 * (multiple browsers, multiple serverless instances) can't double-record the
 * same auto-pick: whoever writes first wins, the loser reloads on its next tick.
 */
export async function advanceMockAutoPicks(
  leagueKey: string,
  now: number = Date.now(),
): Promise<void> {
  // Cap the loop well above any real draft length as a runaway guard.
  for (let guard = 0; guard < 1000; guard += 1) {
    const row = await prisma.syncCheckpoint.findUnique({
      where: { id: checkpointId(leagueKey) },
    });
    if (!row?.payload) return;
    let config: MockDraftConfig;
    try {
      config = JSON.parse(row.payload) as MockDraftConfig;
    } catch {
      return;
    }
    const next = autoPickIfDue(config, now);
    if (!next) return;
    const result = await prisma.syncCheckpoint.updateMany({
      where: { id: checkpointId(leagueKey), sequence: row.sequence },
      data: {
        sequence: humanPickCount(next),
        syncedAt: new Date(),
        payload: JSON.stringify(next),
      },
    });
    // Lost the race to another writer; bail and let the next poll reconcile.
    if (result.count === 0) return;
  }
}

export async function loadMockSnapshot(
  leagueKey: string,
): Promise<YahooSyncSnapshot | null> {
  await advanceMockAutoPicks(leagueKey);
  const config = await loadMockConfig(leagueKey);
  if (!config) return null;
  const { picks, order, total, waitingOnUser, waitingSlot } =
    mockDraftResults(config);
  const humanSlots = humanSlotSet(config);
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
      name: humanSlots.has(index + 1)
        ? `Manager (slot ${index + 1})`
        : `Team ${index + 1}`,
      draftSlot: index + 1,
    })),
    draftResults: picks,
    ...({
      mockOrder: order,
      waitingSlot,
      humanSlots: [...humanSlots],
      autoPickAt: (() => {
        const deadline = autoPickDeadline(config);
        return deadline === null ? null : new Date(deadline).toISOString();
      })(),
    } as unknown as Record<string, unknown>),
    syncedAt: new Date().toISOString(),
  };
}
