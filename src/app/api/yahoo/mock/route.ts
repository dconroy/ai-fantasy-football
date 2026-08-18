import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import {
  appendMockUserPick,
  checkpointId,
  loadMockConfig,
  saveMockConfig,
} from "@/adapters/yahoo/mock-store";
import type { MockPlayerSeed } from "@/adapters/yahoo/mock-runner";
import type { MockDraftConfig } from "@/adapters/yahoo/mock-runner";
import {
  elapsedPickCount,
  projectedDraftOrder,
  waitingSlot,
} from "@/adapters/yahoo/mock-runner";

export const runtime = "nodejs";

const ALLOWED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "start" | "confirm";
        leagueKey?: string;
        playerId?: string;
        slot?: number;
        userSlot?: number;
        humanSlots?: number[];
        teamCount?: number;
        rounds?: number;
        intervalMs?: number;
        players?: Array<Partial<MockPlayerSeed> & { position?: string }>;
      }
    | null;

  const leagueKey = body?.leagueKey?.trim();
  if (!body || !leagueKey || !leagueKey.startsWith("mock.")) {
    return NextResponse.json(
      { error: "leagueKey must start with 'mock.'" },
      { status: 400 },
    );
  }

  if (body.action === "confirm") {
    if (!body.playerId) {
      return NextResponse.json({ error: "playerId required" }, { status: 400 });
    }
    try {
      const config = await appendMockUserPick(
        leagueKey,
        body.playerId,
        body.slot,
      );
      return NextResponse.json({
        leagueKey,
        picksBySlot: config.picksBySlot ?? {},
        startedAt: config.startedAtIso,
        waitingSlot: waitingSlot(config),
        picksProjected: projectedDraftOrder(config).length,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Confirm failed" },
        { status: 400 },
      );
    }
  }

  const teamCount = body.teamCount ?? 12;
  const rounds = body.rounds ?? 15;
  const intervalMs = Math.max(1000, body.intervalMs ?? 8000);
  const humanSlots = [
    ...new Set(
      (body.humanSlots && body.humanSlots.length > 0
        ? body.humanSlots
        : [body.userSlot ?? 1]
      ).filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= teamCount),
    ),
  ].sort((a, b) => a - b);

  const players: MockPlayerSeed[] = (body.players ?? [])
    .filter((player) => player?.id && player.name && player.position)
    .filter((player) => ALLOWED_POSITIONS.has(String(player.position)))
    .map((player) => ({
      id: String(player.id),
      name: String(player.name),
      position: player.position as MockPlayerSeed["position"],
      team: String(player.team ?? "FA"),
      chenRank: player.chenRank,
      adp: player.adp,
    }));

  if (players.length < teamCount * rounds) {
    return NextResponse.json(
      {
        error: `Need at least ${teamCount * rounds} players; received ${players.length}`,
      },
      { status: 400 },
    );
  }

  const config: MockDraftConfig = {
    leagueKey,
    teamCount,
    rounds,
    humanSlots,
    intervalMs,
    startedAtIso: new Date().toISOString(),
    players,
    picksBySlot: {},
  };

  await saveMockConfig(config);

  return NextResponse.json({
    leagueKey,
    startedAt: config.startedAtIso,
    intervalMs,
    humanSlots,
    totalPicks: teamCount * rounds,
  });
}

export async function GET(request: Request) {
  const leagueKey = new URL(request.url).searchParams.get("leagueKey");
  if (!leagueKey) {
    return NextResponse.json({ error: "leagueKey required" }, { status: 400 });
  }
  const config = await loadMockConfig(leagueKey);
  if (!config) {
    return NextResponse.json({ running: false });
  }
  const now = Date.now();
  const projected = projectedDraftOrder(config);
  const readyCount = Math.min(projected.length, elapsedPickCount(config, now));
  const blockedOn = waitingSlot(config, now);
  return NextResponse.json({
    running: true,
    leagueKey,
    startedAt: config.startedAtIso,
    intervalMs: config.intervalMs,
    teamCount: config.teamCount,
    rounds: config.rounds,
    humanSlots: config.humanSlots ?? (config.userSlot ? [config.userSlot] : []),
    picksMade: readyCount,
    totalPicks: config.teamCount * config.rounds,
    waitingOnUser: blockedOn !== null,
    waitingSlot: blockedOn,
    picksBySlot: config.picksBySlot ?? {},
    nextPickAt:
      blockedOn !== null
        ? null
        : new Date(
            Date.parse(config.startedAtIso) +
              (readyCount + 1) * config.intervalMs,
          ).toISOString(),
  });
}

export async function DELETE(request: Request) {
  const leagueKey = new URL(request.url).searchParams.get("leagueKey");
  if (!leagueKey) {
    return NextResponse.json({ error: "leagueKey required" }, { status: 400 });
  }
  await prisma.syncCheckpoint
    .delete({ where: { id: checkpointId(leagueKey) } })
    .catch(() => undefined);
  return NextResponse.json({ stopped: true });
}
