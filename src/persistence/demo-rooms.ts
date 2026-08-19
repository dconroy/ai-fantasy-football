import { randomUUID } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import {
  getOrCreateLeagueDraft,
  saveSharedDraft,
  type SharedDraft,
} from "@/persistence/league-draft";
import {
  claimHumanSlot,
  startMockClock,
  type MockDraftConfig,
  type MockPlayerSeed,
} from "@/adapters/yahoo/mock-runner";
import { loadMockConfig, saveMockConfig } from "@/adapters/yahoo/mock-store";

export const DEMO_ROOM_PREFIX = "demo:";
const MAX_OPEN_ROOMS = 8;
const COMPLETE_TTL_MS = 45 * 60 * 1000;

function leagueKeyFor(roomId: string) {
  return `mock.${roomId.replace(/:/g, ".")}`;
}

export function isDemoRoomId(id: string) {
  return id.startsWith(DEMO_ROOM_PREFIX);
}

async function recycleStaleRooms() {
  const rooms = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    select: { id: true, picksJson: true, teamCount: true, rounds: true, updatedAt: true },
  });
  const now = Date.now();
  for (const room of rooms) {
    let picks = 0;
    try {
      picks = (JSON.parse(room.picksJson) as unknown[]).length;
    } catch {
      picks = 0;
    }
    const complete = picks >= room.teamCount * room.rounds;
    const stale = now - room.updatedAt.getTime() > COMPLETE_TTL_MS;
    if (complete && stale) {
      await prisma.leagueDraft.delete({ where: { id: room.id } }).catch(() => undefined);
      await prisma.syncCheckpoint
        .delete({ where: { id: `mock:${leagueKeyFor(room.id)}` } })
        .catch(() => undefined);
    }
  }
}

function openSeats(config: MockDraftConfig | null, shared: SharedDraft) {
  const taken = new Set(config?.humanSlots ?? []);
  const complete = shared.picks.length >= shared.teamCount * shared.rounds;
  return {
    complete,
    taken,
    openCount: complete ? 0 : Math.max(0, shared.teamCount - taken.size),
  };
}

async function createPausedRoom(): Promise<{ shared: SharedDraft; leagueKey: string }> {
  const roomId = `${DEMO_ROOM_PREFIX}${randomUUID()}`;
  const shared = await getOrCreateLeagueDraft(roomId);
  const leagueKey = leagueKeyFor(roomId);
  const players: MockPlayerSeed[] = shared.players.map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    chenRank: player.chenRank,
    adp: player.adp,
  }));
  await saveMockConfig({
    leagueKey,
    teamCount: shared.teamCount,
    rounds: shared.rounds,
    intervalMs: 3000,
    startedAtIso: "",
    humanSlots: [],
    picksBySlot: {},
    autoPickMs: 20000,
    varietySeed: randomUUID(),
    players,
  });
  const next = await saveSharedDraft({
    draftId: roomId,
    mode: "live",
    leagueKey,
  });
  return { shared: next, leagueKey };
}

export async function findOrCreateOpenDemoRoom(): Promise<{
  shared: SharedDraft;
  config: MockDraftConfig | null;
}> {
  await recycleStaleRooms();
  const rooms = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    orderBy: { createdAt: "desc" },
  });
  for (const row of rooms) {
    const shared = await getOrCreateLeagueDraft(row.id);
    const config = shared.leagueKey ? await loadMockConfig(shared.leagueKey) : null;
    const seats = openSeats(config, shared);
    if (!seats.complete && seats.openCount > 0) {
      return { shared, config };
    }
  }
  const openCount = rooms.length;
  if (openCount >= MAX_OPEN_ROOMS) {
    const newest = rooms[0];
    if (newest) {
      const shared = await getOrCreateLeagueDraft(newest.id);
      const config = shared.leagueKey ? await loadMockConfig(shared.leagueKey) : null;
      return { shared, config };
    }
  }
  const created = await createPausedRoom();
  const config = await loadMockConfig(created.leagueKey);
  return { shared: created.shared, config };
}

export async function claimDemoSeat(roomId: string): Promise<{
  shared: SharedDraft;
  slot: number;
  config: MockDraftConfig;
}> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) throw new Error("Demo room is missing a mock key");
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) throw new Error("Demo room is not ready");
  const taken = new Set(loaded.humanSlots ?? []);
  let slot = 0;
  for (let seat = 1; seat <= shared.teamCount; seat += 1) {
    if (!taken.has(seat)) {
      slot = seat;
      break;
    }
  }
  if (!slot) throw new Error("This demo room is full");
  const claimed = claimHumanSlot(loaded, slot);
  const started = startMockClock(claimed);
  await saveMockConfig(started);
  return { shared, slot, config: started };
}
