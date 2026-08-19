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
// A room with no mock config is a half-created/orphaned shell (e.g. recreated
// from a stale cookie). Give creation a grace window, then recycle it.
const BROKEN_ROOM_TTL_MS = 2 * 60 * 1000;
// A demo seat whose client stops polling for this long is considered abandoned:
// the seat frees up for a new joiner (the mock keeps auto-drafting it meanwhile).
const SEAT_IDLE_MS = 60 * 1000;
// Don't write a heartbeat more often than this per seat (clients poll ~3s).
const SEAT_HEARTBEAT_THROTTLE_MS = 8 * 1000;

/**
 * Per-seat heartbeats live in their own checkpoint row, decoupled from the mock
 * config (which uses optimistic concurrency for picks). Keeping them separate
 * means a heartbeat write can never clobber a concurrent pick write.
 */
function seatSeenKey(roomId: string) {
  return `demo-seats:${roomId}`;
}

async function loadSeatSeen(roomId: string): Promise<Record<number, string>> {
  const row = await prisma.syncCheckpoint.findUnique({
    where: { id: seatSeenKey(roomId) },
  });
  if (!row?.payload) return {};
  try {
    return JSON.parse(row.payload) as Record<number, string>;
  } catch {
    return {};
  }
}

async function saveSeatSeen(roomId: string, seen: Record<number, string>) {
  await prisma.syncCheckpoint.upsert({
    where: { id: seatSeenKey(roomId) },
    create: { id: seatSeenKey(roomId), sequence: 0, syncedAt: new Date(), payload: JSON.stringify(seen) },
    update: { syncedAt: new Date(), payload: JSON.stringify(seen) },
  });
}

/** Human slots whose heartbeat is still fresh — i.e. actively held right now. */
function activeSeatSet(
  humanSlots: readonly number[] | undefined,
  seen: Record<number, string>,
  now = Date.now(),
): Set<number> {
  const active = new Set<number>();
  for (const slot of humanSlots ?? []) {
    const ts = Date.parse(seen[slot] ?? "");
    if (Number.isFinite(ts) && now - ts < SEAT_IDLE_MS) active.add(slot);
  }
  return active;
}

/** Refresh the heartbeat for a seat a demo client is actively polling. */
export async function touchDemoSeat(roomId: string, slot: number | null): Promise<void> {
  if (!slot) return;
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) return;
  const config = await loadMockConfig(shared.leagueKey);
  if (!config || !(config.humanSlots ?? []).includes(slot)) return;
  const seen = await loadSeatSeen(roomId);
  const last = Date.parse(seen[slot] ?? "");
  if (Number.isFinite(last) && Date.now() - last < SEAT_HEARTBEAT_THROTTLE_MS) return;
  await saveSeatSeen(roomId, { ...seen, [slot]: new Date().toISOString() });
}

function leagueKeyFor(roomId: string) {
  return `mock.${roomId.replace(/:/g, ".")}`;
}

export function isDemoRoomId(id: string) {
  return id.startsWith(DEMO_ROOM_PREFIX);
}

async function deleteRoom(roomId: string) {
  await prisma.leagueDraft.delete({ where: { id: roomId } }).catch(() => undefined);
  await prisma.syncCheckpoint
    .delete({ where: { id: `mock:${leagueKeyFor(roomId)}` } })
    .catch(() => undefined);
  await prisma.syncCheckpoint
    .delete({ where: { id: seatSeenKey(roomId) } })
    .catch(() => undefined);
}

async function recycleStaleRooms() {
  const rooms = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    select: {
      id: true,
      leagueKey: true,
      picksJson: true,
      teamCount: true,
      rounds: true,
      updatedAt: true,
    },
  });
  const now = Date.now();
  for (const room of rooms) {
    // Orphaned shell (no mock key) that's past the creation grace window.
    if (!room.leagueKey && now - room.updatedAt.getTime() > BROKEN_ROOM_TTL_MS) {
      await deleteRoom(room.id);
      continue;
    }
    let picks = 0;
    try {
      picks = (JSON.parse(room.picksJson) as unknown[]).length;
    } catch {
      picks = 0;
    }
    const complete = picks >= room.teamCount * room.rounds;
    const stale = now - room.updatedAt.getTime() > COMPLETE_TTL_MS;
    if (complete && stale) {
      await deleteRoom(room.id);
    }
  }
}

function openSeats(
  config: MockDraftConfig | null,
  shared: SharedDraft,
  activeSlots: Set<number>,
) {
  // No mock config means the room is a broken shell — never joinable.
  if (!config || !shared.leagueKey) {
    return { complete: false, taken: new Set<number>(), openCount: 0, broken: true };
  }
  const complete = shared.picks.length >= shared.teamCount * shared.rounds;
  return {
    complete,
    taken: activeSlots,
    openCount: complete ? 0 : Math.max(0, shared.teamCount - activeSlots.size),
    broken: false,
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
  const healthy: Array<{ shared: SharedDraft; config: MockDraftConfig }> = [];
  for (const row of rooms) {
    const shared = await getOrCreateLeagueDraft(row.id);
    const config = shared.leagueKey ? await loadMockConfig(shared.leagueKey) : null;
    const active = config
      ? activeSeatSet(config.humanSlots, await loadSeatSeen(row.id))
      : new Set<number>();
    const seats = openSeats(config, shared, active);
    if (seats.broken || !config) continue; // skip orphaned shells entirely
    if (!seats.complete && seats.openCount > 0) {
      return { shared, config };
    }
    healthy.push({ shared, config });
  }
  // Too many live rooms already: reuse the newest healthy one instead of sprawling.
  if (healthy.length >= MAX_OPEN_ROOMS && healthy[0]) {
    return { shared: healthy[0].shared, config: healthy[0].config };
  }
  const created = await createPausedRoom();
  const config = await loadMockConfig(created.leagueKey);
  return { shared: created.shared, config };
}

export interface DemoRoomSummary {
  readonly id: string;
  readonly totalSeats: number;
  readonly activeSeats: number;
  readonly openSeats: number;
  readonly picks: number;
  readonly totalPicks: number;
  readonly started: boolean;
  readonly complete: boolean;
}

/** Live demo rooms with seat availability, for the landing-page room list. */
export async function listDemoRooms(): Promise<DemoRoomSummary[]> {
  await recycleStaleRooms();
  const rows = await prisma.leagueDraft.findMany({
    where: { id: { startsWith: DEMO_ROOM_PREFIX } },
    orderBy: { createdAt: "desc" },
  });
  const summaries: DemoRoomSummary[] = [];
  for (const row of rows) {
    const shared = await getOrCreateLeagueDraft(row.id);
    if (!shared.leagueKey) continue; // orphaned shell
    const config = await loadMockConfig(shared.leagueKey);
    if (!config) continue;
    const active = activeSeatSet(config.humanSlots, await loadSeatSeen(row.id));
    const totalPicks = shared.teamCount * shared.rounds;
    const complete = shared.picks.length >= totalPicks;
    summaries.push({
      id: row.id,
      totalSeats: shared.teamCount,
      activeSeats: active.size,
      openSeats: complete ? 0 : Math.max(0, shared.teamCount - active.size),
      picks: shared.picks.length,
      totalPicks,
      started: Boolean(config.startedAtIso) && Number.isFinite(Date.parse(config.startedAtIso)),
      complete,
    });
  }
  return summaries;
}

/** Seats actively held by a human right now (abandoned seats read as open). */
export async function takenSeatsFor(roomId: string): Promise<number[]> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) return [];
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) return [];
  const active = activeSeatSet(loaded.humanSlots, await loadSeatSeen(roomId));
  return [...active].sort((a, b) => a - b);
}

export async function claimDemoSeat(
  roomId: string,
  requestedSlot?: number | null,
): Promise<{
  shared: SharedDraft;
  slot: number;
  config: MockDraftConfig;
}> {
  const shared = await getOrCreateLeagueDraft(roomId);
  if (!shared.leagueKey) throw new Error("Demo room is missing a mock key");
  const loaded = await loadMockConfig(shared.leagueKey);
  if (!loaded) throw new Error("Demo room is not ready");
  const seen = await loadSeatSeen(roomId);
  const active = activeSeatSet(loaded.humanSlots, seen);

  let slot = 0;
  if (requestedSlot != null) {
    if (
      !Number.isInteger(requestedSlot) ||
      requestedSlot < 1 ||
      requestedSlot > shared.teamCount
    ) {
      throw new Error(`Seat ${requestedSlot} is not a valid slot`);
    }
    if (active.has(requestedSlot)) {
      throw new Error(`Seat ${requestedSlot} is already taken`);
    }
    slot = requestedSlot;
  } else {
    for (let seat = 1; seat <= shared.teamCount; seat += 1) {
      if (!active.has(seat)) {
        slot = seat;
        break;
      }
    }
  }

  if (!slot) throw new Error("This demo room is full");
  // Re-claiming an abandoned seat: it's already a human slot, so keep its picks
  // and just re-arm the heartbeat. A robot seat gets promoted to human.
  const alreadyHuman = (loaded.humanSlots ?? []).includes(slot);
  const started = startMockClock(alreadyHuman ? loaded : claimHumanSlot(loaded, slot));
  if (!alreadyHuman) await saveMockConfig(started);
  await saveSeatSeen(roomId, { ...seen, [slot]: new Date().toISOString() });
  return { shared, slot, config: started };
}
