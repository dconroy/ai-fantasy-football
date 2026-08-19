import { randomUUID } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import {
  getOrCreateLeagueDraft,
  saveSharedDraft,
  seedPlayersForScoring,
  type SharedDraft,
} from "@/persistence/league-draft";
import {
  parseChenScoring,
  scoringFromSource,
  type ChenScoring,
} from "@/adapters/chen/boris-chen";
import {
  claimHumanSlot,
  startMockClock,
  type MockDraftConfig,
  type MockPlayerSeed,
} from "@/adapters/yahoo/mock-runner";
import {
  loadMockConfig,
  loadMockSnapshot,
  saveMockConfig,
} from "@/adapters/yahoo/mock-store";

export const DEMO_ROOM_PREFIX = "demo:";
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
  for (const row of rooms) {
    const shared = await getOrCreateLeagueDraft(row.id);
    const config = shared.leagueKey ? await loadMockConfig(shared.leagueKey) : null;
    const active = config
      ? activeSeatSet(config.humanSlots, await loadSeatSeen(row.id))
      : new Set<number>();
    const seats = openSeats(config, shared, active);
    if (seats.broken || !config) continue; // skip orphaned shells entirely
    const snapshot = await loadMockSnapshot(config.leagueKey);
    const complete =
      seats.complete ||
      (snapshot?.draftResults.length ?? 0) >= config.teamCount * config.rounds;
    if (!complete && seats.openCount > 0) {
      return { shared, config };
    }
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
  readonly openSeatList: readonly number[];
  readonly scoring: ChenScoring;
  readonly rounds: number;
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
    const snapshot = await loadMockSnapshot(shared.leagueKey);
    const active = activeSeatSet(config.humanSlots, await loadSeatSeen(row.id));
    const totalPicks = config.teamCount * config.rounds;
    const picks = Math.max(shared.picks.length, snapshot?.draftResults.length ?? 0);
    const complete = picks >= totalPicks;
    const openSeatList = Array.from(
      { length: shared.teamCount },
      (_, index) => index + 1,
    ).filter((slot) => !active.has(slot));
    summaries.push({
      id: row.id,
      totalSeats: shared.teamCount,
      activeSeats: active.size,
      openSeats: complete ? 0 : Math.max(0, shared.teamCount - active.size),
      openSeatList: complete ? [] : openSeatList,
      scoring: scoringFromSource(shared.source),
      rounds: shared.rounds,
      picks,
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
  const snapshot = await loadMockSnapshot(shared.leagueKey);
  if (
    snapshot &&
    snapshot.draftResults.length >= loaded.teamCount * loaded.rounds
  ) {
    throw new Error("This demo draft is complete");
  }
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

export interface CreateDemoRoomInput {
  readonly scoring: ChenScoring;
  readonly teamCount: number;
  readonly rounds: number;
  readonly slot: number;
}

export function validateDemoRoomInput(input: {
  scoring?: unknown;
  teamCount?: unknown;
  rounds?: unknown;
  slot?: unknown;
}): CreateDemoRoomInput {
  const scoringRaw = typeof input.scoring === "string" ? input.scoring : "";
  if (!["standard", "half-ppr", "ppr"].includes(scoringRaw)) {
    throw new Error("Scoring must be Standard, Half PPR, or PPR");
  }
  const scoring = parseChenScoring(scoringRaw);
  const teamCount = Number(input.teamCount);
  const rounds = Number(input.rounds);
  const slot = Number(input.slot);
  if (!Number.isInteger(teamCount) || teamCount < 8 || teamCount > 14) {
    throw new Error("Roster count must be between 8 and 14");
  }
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 16) {
    throw new Error("Rounds must be between 10 and 16");
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > teamCount) {
    throw new Error(`Draft slot must be between 1 and ${teamCount}`);
  }
  return { scoring, teamCount, rounds, slot };
}

export async function createDemoRoom(
  input: CreateDemoRoomInput,
): Promise<{ shared: SharedDraft; slot: number; config: MockDraftConfig }> {
  const settings = validateDemoRoomInput(input);
  const roomId = `${DEMO_ROOM_PREFIX}${randomUUID()}`;
  const leagueKey = leagueKeyFor(roomId);
  const seeded = await seedPlayersForScoring(settings.scoring);
  await prisma.leagueDraft.create({
    data: {
      id: roomId,
      leagueKey,
      mode: "live",
      teamCount: settings.teamCount,
      rounds: settings.rounds,
      playersJson: JSON.stringify(seeded.players),
      importedAt: seeded.importedAt,
      source: seeded.source,
    },
  });
  const players: MockPlayerSeed[] = seeded.players.map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    chenRank: player.chenRank,
    adp: player.adp,
  }));
  const config = startMockClock({
    leagueKey,
    teamCount: settings.teamCount,
    rounds: settings.rounds,
    intervalMs: 3000,
    startedAtIso: "",
    humanSlots: [settings.slot],
    picksBySlot: {},
    autoPickMs: 20000,
    varietySeed: randomUUID(),
    players,
  });
  await saveMockConfig(config);
  await saveSeatSeen(roomId, {
    [settings.slot]: new Date().toISOString(),
  });
  return {
    shared: await getOrCreateLeagueDraft(roomId),
    slot: settings.slot,
    config,
  };
}
