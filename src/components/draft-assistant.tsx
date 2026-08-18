"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  availablePlayers,
  createDraftState,
  makeManualPick,
  nextSelectionForSlot,
  recommendPlayers,
  rosterPicks,
  selectionForOverall,
  type DraftState,
  type Player,
  type Position,
  type StrategyWeights,
} from "@/domain";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import { parseChenCsv } from "@/adapters/chen/boris-chen";
import { MOCK_PLAYERS } from "@/fixtures/mock-players";
import { resolvePlayerIdentity } from "@/domain/identity";

interface RemoteDraftPick {
  pick: number;
  round: number;
  teamKey?: string;
  playerKey?: string;
  playerName?: string;
  playerPosition?: string;
  playerTeam?: string;
}

interface SyncSnapshot {
  draftResults: RemoteDraftPick[];
  mockOrder?: Array<{
    id: string;
    name: string;
    position: string;
    team: string;
  }>;
  syncedAt: string;
}

const STORAGE_KEY = "draft-room-2026-v1";
const POSITIONS: readonly (Position | "ALL")[] = [
  "ALL", "QB", "RB", "WR", "TE", "K", "DEF",
];

interface MemberSeat {
  id: string;
  displayName: string;
  draftSlot: number | null;
  teamName: string | null;
  role: string;
  status: string;
}

interface MeState {
  id: string;
  displayName: string;
  role: "admin" | "member";
  draftSlot: number;
  teamName: string;
  pins: string[];
  avoids: string[];
  weights: StrategyWeights;
  darkMode: boolean;
}

interface PersistedUiState {
  mode: "mock" | "live";
  draft: DraftState;
  players: readonly Player[];
  pins: readonly string[];
  avoids: readonly string[];
  importedAt: string;
  source: string;
  weights: StrategyWeights;
  updatedAt?: string;
  leagueKey?: string | null;
}

interface DraftPayload {
  mode: "mock" | "live";
  draft: DraftState;
  players: readonly Player[];
  importedAt: string;
  source: string;
  updatedAt: string;
  leagueKey?: string | null;
  members: MemberSeat[];
  me: MeState;
}

const initialState: PersistedUiState = {
  mode: "mock",
  draft: createDraftState(1),
  players: MOCK_PLAYERS,
  pins: [],
  avoids: [],
  importedAt: "Synthetic fixture",
  source: "Built-in mock data",
  weights: DEFAULT_STRATEGY_WEIGHTS,
};

function normalizePersisted(state: Partial<PersistedUiState> | null): PersistedUiState {
  if (!state?.draft || !state.players) return initialState;
  return {
    ...initialState,
    ...state,
    mode: state.mode === "live" ? "live" : "mock",
    pins: Array.isArray(state.pins) ? state.pins : [],
    avoids: Array.isArray(state.avoids) ? state.avoids : [],
  };
}

function hydrate(): PersistedUiState {
  if (typeof window === "undefined") return initialState;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved
      ? normalizePersisted(JSON.parse(saved) as Partial<PersistedUiState>)
      : initialState;
  } catch {
    return initialState;
  }
}

function toCsv(state: PersistedUiState) {
  const lines = ["overall,round,draft_slot,my_pick,player,position,team,roster_slot"];
  for (const pick of state.draft.picks) {
    lines.push(
      [
        pick.overall,
        pick.round,
        pick.slot,
        pick.slot === state.draft.userSlot,
        `"${pick.player.name.replaceAll('"', '""')}"`,
        pick.player.position,
        pick.player.team,
        pick.rosterSlot,
      ].join(","),
    );
  }
  return lines.join("\n");
}

function download(filename: string, body: string, type: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([body], { type }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function scoreComparison(
  first: ReturnType<typeof recommendPlayers>["recommendations"][number],
  alternative: ReturnType<typeof recommendPlayers>["recommendations"][number],
) {
  const alternativeFactors = new Map(
    alternative.factors.map((factor) => [factor.factor, factor.contribution]),
  );
  const advantage = first.factors
    .map((factor) => ({
      label: factor.explanation,
      delta: factor.contribution - (alternativeFactors.get(factor.factor) ?? 0),
    }))
    .sort((a, b) => b.delta - a.delta)[0];
  return advantage?.delta > 0
    ? `${first.player.name} leads ${alternative.player.name} by ${(first.score - alternative.score).toFixed(1)} points, primarily because ${advantage.label.toLowerCase()}.`
    : `${first.player.name} wins the calculated tie-break on Chen rank.`;
}

export function DraftAssistant() {
  const [state, setState] = useState<PersistedUiState>(initialState);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [tier, setTier] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [syncPaused, setSyncPaused] = useState(false);
  const [previewMember, setPreviewMember] = useState(false);
  const [dark, setDark] = useState(false);
  const [yahooConnected, setYahooConnected] = useState(false);
  const [notice, setNotice] = useState("Simulation ready");
  const [leagueKey, setLeagueKey] = useState("");
  const [syncIntervalSec, setSyncIntervalSec] = useState(5);
  const [syncStatus, setSyncStatus] = useState<string>("idle");
  const [me, setMe] = useState<MeState | null>(null);
  const [members, setMembers] = useState<MemberSeat[]>([]);
  const [adminUsers, setAdminUsers] = useState<MemberSeat[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function applyPayload(payload: DraftPayload, message?: string) {
    const next = normalizePersisted({
      mode: payload.mode,
      draft: {
        ...payload.draft,
        userSlot: payload.me.draftSlot,
      },
      players: payload.players,
      importedAt: payload.importedAt,
      source: payload.source,
      pins: payload.me.pins,
      avoids: payload.me.avoids,
      weights: payload.me.weights,
      updatedAt: payload.updatedAt,
      leagueKey: payload.leagueKey,
    });
    setState(next);
    setMe(payload.me);
    setMembers(payload.members);
    setDark(payload.me.darkMode);
    if (payload.leagueKey) setLeagueKey(payload.leagueKey);
    if (message) setNotice(message);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/draft")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: DraftPayload | null) => {
        if (cancelled) return;
        if (payload?.draft && payload.players && payload.me) {
          applyPayload(payload, "Loaded shared draft board");
        } else {
          setState(hydrate());
        }
      })
      .catch(() => {
        if (!cancelled) setState(hydrate());
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      fetch("/api/draft", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: DraftPayload | null) => {
          if (!payload?.updatedAt || payload.updatedAt === stateRef.current.updatedAt) return;
          applyPayload(payload);
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    fetch("/api/yahoo/status")
      .then((response) => response.json())
      .then((status: { connected?: boolean }) =>
        setYahooConnected(status.connected === true),
      )
      .catch(() => setYahooConnected(false));
    const yahooResult = new URLSearchParams(window.location.search).get("yahoo");
    if (yahooResult === "connected") setNotice("Yahoo signed in.");
    if (yahooResult === "denied") setNotice("Yahoo authorization was cancelled.");
    if (yahooResult === "error") setNotice("Yahoo authorization failed.");
  }, []);

  useEffect(() => {
    if (me?.role !== "admin") return;
    fetch("/api/admin/users")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { users?: MemberSeat[] } | null) => {
        if (body?.users) setAdminUsers(body.users);
      })
      .catch(() => undefined);
  }, [me?.role, members]);

  useEffect(() => {
    if (!ready || !me) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const timeout = window.setTimeout(() => {
      fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftSlot: state.draft.userSlot,
          pins: state.pins,
          avoids: state.avoids,
          weights: state.weights,
          darkMode: dark,
          teamName: me.teamName,
        }),
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [ready, state.draft.userSlot, state.pins, state.avoids, state.weights, dark, me]);

  const current = selectionForOverall(state.draft.picks.length + 1);
  const nextMine = nextSelectionForSlot(
    current.overall,
    state.draft.userSlot,
    state.draft.rounds,
    state.draft.teamCount,
  );
  const picksUntilMyTurn = nextMine
    ? Math.max(0, nextMine.overall - current.overall)
    : 0;
  const isMyTurn = current.slot === state.draft.userSlot;
  const available = useMemo(
    () => availablePlayers(state.draft, state.players),
    [state.draft, state.players],
  );
  const avoids = useMemo(() => state.avoids ?? [], [state.avoids]);
  const recommendation = useMemo(
    () =>
      recommendPlayers(state.draft, state.players, {
        weights: state.weights,
        excludePlayerIds: avoids,
      }),
    [state.draft, state.players, state.weights, avoids],
  );
  const myRoster = rosterPicks(state.draft.picks, state.draft.userSlot);
  const tiers = [...new Set(available.map((player) => player.chenTier))]
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const filtered = available
    .filter((player) => position === "ALL" || player.position === position)
    .filter((player) => tier === "ALL" || player.chenTier === Number(tier))
    .filter((player) =>
      `${player.name} ${player.team}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const avoidDelta =
        Number(avoids.includes(a.id)) - Number(avoids.includes(b.id));
      const pinDelta =
        Number((state.pins ?? []).includes(b.id)) -
        Number((state.pins ?? []).includes(a.id));
      return (
        avoidDelta ||
        pinDelta ||
        (a.chenRank ?? Number.MAX_SAFE_INTEGER) -
          (b.chenRank ?? Number.MAX_SAFE_INTEGER)
      );
    });

  async function mutateDraft(
    path: string,
    body: Record<string, unknown>,
    message: string,
  ) {
    const response = await fetch(path, {
      method: path.includes("/pick") ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as DraftPayload & {
      error?: string;
    };
    if (!response.ok || !payload?.draft) {
      setNotice(payload?.error ?? "Draft update failed");
      return false;
    }
    applyPayload(payload, message);
    return true;
  }

  function teamLabel(slot: number) {
    if (slot === state.draft.userSlot) return me?.teamName || "COBRA KAI";
    const occupant = members.find((member) => member.draftSlot === slot);
    return occupant?.teamName || occupant?.displayName || `T${slot}`;
  }

  function reconcileRemote(snapshot: SyncSnapshot) {
    const current = stateRef.current;
    const remote = [...snapshot.draftResults].sort((a, b) => a.pick - b.pick);
    const nextLocalOverall = current.draft.picks.length + 1;
    const nextLocalSlot = selectionForOverall(
      nextLocalOverall,
      current.draft.teamCount,
    ).slot;
    if (remote.length <= current.draft.picks.length) {
      setSyncStatus(
        nextLocalSlot === current.draft.userSlot
          ? `your turn · confirm locally (${current.draft.picks.length} picks)`
          : `in sync · ${remote.length} picks`,
      );
      return;
    }
    const mockLookup = new Map(
      (snapshot.mockOrder ?? []).map((player) => [`mock.p.${player.id}`, player]),
    );
    let draft = current.draft;
    let applied = 0;
    const unresolved: string[] = [];
    const isMockHarness = leagueKey.startsWith("mock.");
    for (const pick of remote.slice(current.draft.picks.length)) {
      const nextOverall = draft.picks.length + 1;
      const nextSlot = selectionForOverall(nextOverall, draft.teamCount).slot;
      // In a real Yahoo draft your own pick shows up in draft results like
      // everyone else's, so apply it. Only the mock harness waits for a
      // local confirm.
      if (isMockHarness && nextSlot === draft.userSlot) {
        unresolved.push(`pick ${nextOverall}: your turn — confirm locally to advance`);
        break;
      }
      const mockPlayer = pick.playerKey ? mockLookup.get(pick.playerKey) : undefined;
      const query = mockPlayer?.name ?? pick.playerName ?? "";
      const team = mockPlayer?.team ?? pick.playerTeam;
      if (!query) {
        unresolved.push(`pick ${pick.pick}: no player name`);
        break;
      }
      const identity = resolvePlayerIdentity(query, current.players, { team });
      if (identity.status !== "resolved") {
        unresolved.push(`pick ${pick.pick}: ${identity.status} for ${query}`);
        break;
      }
      try {
        draft = makeManualPick(draft, identity.player, {
          madeAt: snapshot.syncedAt,
        });
        applied += 1;
      } catch (error) {
        unresolved.push(
          `pick ${pick.pick}: ${error instanceof Error ? error.message : "failed"}`,
        );
        break;
      }
    }
    if (applied > 0) {
      void mutateDraft(
        "/api/draft",
        { action: "picks", picks: draft.picks, expectedUpdatedAt: current.updatedAt },
        `Synced ${applied} remote pick(s).`,
      );
    }
    if (unresolved.length) {
      setSyncStatus(`${remote.length} remote · stopped at ${unresolved[0]}`);
    } else {
      setSyncStatus(`in sync · ${remote.length} picks`);
    }
  }

  useEffect(() => {
    if (state.mode !== "live" || syncPaused || !leagueKey.trim()) {
      setSyncStatus(state.mode === "live" ? "paused" : "idle");
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/yahoo/sync?leagueKey=${encodeURIComponent(leagueKey.trim())}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (!cancelled) setSyncStatus(`error · ${body.error ?? response.status}`);
          return;
        }
        const snapshot = (await response.json()) as SyncSnapshot;
        if (!cancelled) reconcileRemote(snapshot);
      } catch (error) {
        if (!cancelled) {
          setSyncStatus(
            `error · ${error instanceof Error ? error.message : "network"}`,
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, Math.max(1000, syncIntervalSec * 1000));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // reconcileRemote intentionally excluded — it reads latest state via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, syncPaused, leagueKey, syncIntervalSec]);

  async function startMockHarness() {
    if (state.players.length < 60) {
      setNotice("Load Chen or import a CSV before starting the mock harness.");
      return;
    }
    const key = `mock.${Math.random().toString(36).slice(2, 8)}`;
    setNotice("Starting mock draft harness…");
    const response = await fetch("/api/yahoo/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueKey: key,
        userSlot: state.draft.userSlot,
        teamCount: state.draft.teamCount,
        rounds: state.draft.rounds,
        intervalMs: Math.max(1000, syncIntervalSec * 1000),
        players: state.players.map((player) => ({
          id: player.id,
          name: player.name,
          position: player.position,
          team: player.team,
          chenRank: player.chenRank,
          adp: player.adp,
        })),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setNotice(`Mock harness failed: ${body.error ?? response.status}`);
      return;
    }
    await mutateDraft(
      "/api/draft",
      { action: "reset", mode: "live", leagueKey: key },
      `Mock harness ${key} running — new pick every ${syncIntervalSec}s.`,
    );
    setLeagueKey(key);
    setSyncPaused(false);
    setSelected(null);
  }

  async function startSession(mode: "mock" | "live") {
    if (
      state.draft.picks.length > 0 &&
      !window.confirm(
        `Clear all ${state.draft.picks.length} recorded picks and start a clean ${mode} draft?`,
      )
    ) {
      return;
    }
    setSelected(null);
    setSyncPaused(mode === "mock");
    await mutateDraft(
      "/api/draft",
      { action: "reset", mode },
      mode === "mock"
        ? `Joined a new mock draft from slot ${state.draft.userSlot}.`
        : `Live board reset and ready from slot ${state.draft.userSlot}.`,
    );
  }

  async function confirm(player: Player) {
    if (!isMyTurn) {
      setNotice(`Pick ${current.overall} belongs to draft slot ${current.slot}.`);
      return;
    }
    try {
      if (leagueKey.startsWith("mock.")) {
        const response = await fetch("/api/yahoo/mock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
            leagueKey,
            playerId: player.id,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setNotice(
            `Mock harness rejected confirm: ${body.error ?? response.status}`,
          );
          return;
        }
      }
      const ok = await mutateDraft(
        "/api/draft/pick",
        { playerId: player.id },
        leagueKey.startsWith("mock.")
          ? `Confirmed ${player.name}. Mock resume — next opponent in ~${syncIntervalSec}s.`
          : `Confirmed ${player.name} locally. Still submit the pick in Yahoo.`,
      );
      if (ok) setSelected(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to record pick");
    }
  }

  async function markDrafted(player: Player) {
    await mutateDraft(
      "/api/draft/pick",
      { playerId: player.id },
      `Recorded ${player.name} at pick ${current.overall}.`,
    );
  }

  async function simulateToTurn() {
    if (state.mode !== "mock") {
      setNotice("Simulation is disabled on the live draft board.");
      return;
    }
    await mutateDraft(
      "/api/draft/pick",
      { action: "simulate" },
      "Simulated to your pick.",
    );
  }

  function toggleList(key: "pins" | "avoids", id: string) {
    setState((previous) => {
      const current = previous[key] ?? [];
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      return { ...previous, [key]: next };
    });
    if (key === "avoids" && selected === id) setSelected(null);
  }

  async function importFile(file?: File) {
    if (!file) return;
    const parsed = parseChenCsv(await file.text(), file.name);
    if (!parsed.players.length) {
      setNotice(parsed.warnings[0] ?? "No usable players found");
      return;
    }
    const players: Player[] = parsed.players.map((player) => ({
      id: player.sourceId,
      name: player.name,
      position: player.position,
      team: player.team ?? "FA",
      chenRank: player.overallRank,
      chenTier: player.tier,
      byeWeek: player.byeWeek,
      adp: player.adp,
    }));
    await mutateDraft(
      "/api/draft",
      {
        action: "players",
        players,
        importedAt: parsed.importedAt,
        source: parsed.source,
      },
      `Imported ${players.length} players; ${parsed.warnings.length} warning(s).`,
    );
  }

  async function fetchChen() {
    setNotice("Loading public Chen PPR data…");
    try {
      const response = await fetch("/api/chen");
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed.error ?? "Import failed");
      const players: Player[] = parsed.players.map(
        (player: {
          sourceId: string; name: string; position: Position; team?: string;
          overallRank: number; tier: number; byeWeek?: number; adp?: number;
        }) => ({
          id: player.sourceId,
          name: player.name,
          position: player.position,
          team: player.team ?? "FA",
          chenRank: player.overallRank,
          chenTier: player.tier,
          byeWeek: player.byeWeek,
          adp: player.adp,
        }),
      );
      await mutateDraft(
        "/api/draft",
        {
          action: "players",
          players,
          importedAt: parsed.importedAt,
          source: parsed.source,
        },
        `Loaded ${players.length} current source records.`,
      );
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : "Chen fetch failed"}. Use manual CSV import.`,
      );
    }
  }

  const selectedPlayer =
    available.find(
      (player) => player.id === selected && !avoids.includes(player.id),
    ) ?? recommendation.recommendations[0]?.player;

  const isAdmin = me?.role === "admin";
  const adminView = isAdmin && !previewMember;
  const pendingCount = adminUsers.filter((user) => user.status === "pending").length;

  async function patchUser(id: string, data: Record<string, unknown>) {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...data }),
    });
    const body = (await response.json().catch(() => null)) as {
      user?: MemberSeat;
      error?: string;
    } | null;
    if (!response.ok || !body?.user) {
      setNotice(body?.error ?? "Member update failed");
      return;
    }
    const updated = body.user;
    setAdminUsers((previous) =>
      previous.map((user) => (user.id === updated.id ? updated : user)),
    );
    setMembers((previous) =>
      previous.map((user) => (user.id === updated.id ? updated : user)),
    );
    setNotice(`Updated ${updated.displayName}.`);
  }

  if (!ready) return <main className="loading">Loading draft room…</main>;

  return (
    <main className={dark ? "app dark" : "app"}>
      <header className="topbar">
        <div className="brand-lockup">
          <Image
            className="brand-mark"
            src="https://raw.githubusercontent.com/dconroy/ai-fantasy-football/main/image%20%2814%29.png"
            alt="Full Contact fantasy football league"
            width={58}
            height={58}
            unoptimized
            priority
          />
          <div className="brand-copy">
            <p className="eyebrow">Cobra Kai · Full Contact · 2026</p>
            <h1>Conroy&apos;s AI Draft Dojo</h1>
            <p className="brand-tagline">Strike first. Draft smart. Conroy&apos;s AI gonna fuck you up.</p>
          </div>
        </div>
        <div className="status-row">
          <a className="status" href="/weekly">Weekly HQ</a>
          <span className={`status ${state.mode === "mock" ? "simulation" : "live"}`}>
            ● {state.mode === "mock" ? "Mock draft" : "Live board"}
          </span>
          {yahooConnected ? (
            <span className="status connected">
              ● {me?.displayName ?? "Yahoo"} signed in
            </span>
          ) : (
            <a className="status yahoo-connect" href="/api/yahoo/auth">
              Sign in with Yahoo
            </a>
          )}
          {isAdmin && (
            <button
              className={`icon-button ${previewMember ? "preview-active" : ""}`}
              onClick={() => setPreviewMember((value) => !value)}
              title="Preview the app the way a regular member sees it"
            >
              {previewMember ? "Exit member view" : "View as member"}
            </button>
          )}
          <form action="/api/auth/logout" method="post">
            <button className="icon-button" type="submit">Sign out</button>
          </form>
          <button className="icon-button" onClick={() => setDark((value) => !value)}>
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {isAdmin && previewMember && (
        <div className="preview-banner" role="status">
          <span>
            Member preview — you&apos;re seeing exactly what your league-mates see.
            Admin tools are hidden but you&apos;re still the admin.
          </span>
          <button onClick={() => setPreviewMember(false)}>Back to admin view</button>
        </div>
      )}

      <section className="control-strip">
        <label>
          Draft slot
          <select
            value={state.draft.userSlot}
            onChange={(event) =>
              setState((previous) => ({
                ...previous,
                draft: { ...previous.draft, userSlot: Number(event.target.value) },
              }))
            }
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1}>{index + 1}</option>
            ))}
          </select>
        </label>
        <div className="turn-indicator">
          <strong>{isMyTurn ? "You’re on the clock" : `${picksUntilMyTurn} picks until your turn`}</strong>
          <span>
            Pick {current.overall} · Round {current.round} · Slot {current.slot}
          </span>
        </div>
        {adminView ? (
          <>
            <button
              onClick={simulateToTurn}
              disabled={state.mode !== "mock" || isMyTurn}
            >
              Simulate to my pick
            </button>
            <button
              className="secondary"
              onClick={() => void mutateDraft("/api/draft/pick", { action: "advance" }, "Advanced one pick.")}
              disabled={state.mode !== "mock" || isMyTurn}
            >
              Advance one
            </button>
            <button
              className="secondary"
              onClick={() => void mutateDraft("/api/draft/pick", { action: "undo" }, "Undid the latest pick.")}
              disabled={!state.draft.picks.length}
            >
              Undo
            </button>
            <span className="strip-spacer" />
            <button className="secondary" onClick={() => startSession("mock")}>
              New mock draft
            </button>
            <button className="live-button" onClick={() => startSession("live")}>
              Prepare live board
            </button>
          </>
        ) : (
          <span className="strip-hint">
            The board is shared — the admin runs mocks, resets, and syncing.
            You pick players, pins, and avoids.
          </span>
        )}
      </section>

      <div className="notice" role="status">{notice}</div>

      <section className="workspace">
        <aside className="panel recommendations">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Calculated after every pick</p>
              <h2>Top five</h2>
            </div>
            <span>{recommendation.picksUntilFollowingSelection ?? "—"} until following turn</span>
          </div>
          {recommendation.recommendations.map((item, index) => (
            <article
              key={item.player.id}
              className={`recommendation ${index === 0 ? "first" : ""}`}
              onClick={() => setSelected(item.player.id)}
            >
              <div className="rank">{index + 1}</div>
              <div className="recommendation-copy">
                <div className="player-line">
                  <strong>{item.player.name}</strong>
                  <span className={`position ${item.player.position.toLowerCase()}`}>
                    {item.player.position}
                  </span>
                  <span>T{item.player.chenTier ?? "—"}</span>
                </div>
                <p>{item.explanations[0] ?? "Best calculated value available"}</p>
                <small>Score {item.score.toFixed(1)} · {item.suggestedRosterSlot}</small>
              </div>
              {index === 0 && <span className="best-badge">BEST</span>}
            </article>
          ))}
          {recommendation.recommendations[0] && (
            <div className="comparison">
              <strong>Why #1?</strong>
              {recommendation.recommendations.slice(1, 3).map((alternative) => (
                <p key={alternative.player.id}>
                  {scoreComparison(recommendation.recommendations[0], alternative)}
                </p>
              ))}
            </div>
          )}
          <button
            className="confirm"
            disabled={!isMyTurn || !selectedPlayer}
            onClick={() => selectedPlayer && confirm(selectedPlayer)}
          >
            Confirm {selectedPlayer?.name ?? "pick"} locally
          </button>
          <p className="safety-note">
            Picks are recorded on this board only — make the real pick in the Yahoo app.
          </p>
        </aside>

        <section className="panel available-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Chen-first rankings</p>
              <h2>Best available <span>{available.length}</span></h2>
            </div>
            {adminView && (
              <div className="import-actions">
                <button className="secondary" onClick={fetchChen}>Fetch Chen PPR</button>
                <button className="secondary" onClick={() => importRef.current?.click()}>
                  Import CSV
                </button>
                <input
                  ref={importRef}
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => importFile(event.target.files?.[0])}
                />
              </div>
            )}
          </div>
          <p className="data-source">{state.source} · {state.importedAt}</p>
          <div className="filters">
            <input
              placeholder="Search players or teams"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={position} onChange={(event) => setPosition(event.target.value as Position | "ALL")}>
              {POSITIONS.map((value) => <option key={value}>{value}</option>)}
            </select>
            <select value={tier} onChange={(event) => setTier(event.target.value)}>
              <option value="ALL">All tiers</option>
              {tiers.map((value) => <option key={value} value={value}>Tier {value}</option>)}
            </select>
          </div>
          <div className="player-table" role="table">
            <div className="table-row table-head" role="row">
              <span>Rank</span><span>Player</span><span>Tier</span><span>ADP</span><span>Actions</span>
            </div>
            {filtered.slice(0, 80).map((player) => (
              <div
                className={`table-row ${selected === player.id ? "selected" : ""} ${avoids.includes(player.id) ? "avoided" : ""}`}
                key={player.id}
                onClick={() => setSelected(player.id)}
                role="row"
              >
                <span>{player.chenRank ?? "—"}</span>
                <span>
                  <strong>{player.name}</strong>
                  <small>{player.position} · {player.team} · Bye {player.byeWeek ?? "—"}</small>
                </span>
                <span><i className={`tier tier-${Math.min(player.chenTier ?? 8, 8)}`}>T{player.chenTier ?? "—"}</i></span>
                <span>{player.adp ?? "—"}</span>
                <span className="row-actions">
                  <button onClick={(event) => { event.stopPropagation(); toggleList("pins", player.id); }}>
                    {(state.pins ?? []).includes(player.id) ? "★" : "☆"}
                  </button>
                  <button onClick={(event) => { event.stopPropagation(); toggleList("avoids", player.id); }}>
                    {avoids.includes(player.id) ? "Allow" : "Avoid"}
                  </button>
                  <button onClick={(event) => { event.stopPropagation(); markDrafted(player); }}>
                    Drafted
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <aside className="right-column">
          <section className="panel roster">
            <div className="panel-heading"><h2>My roster</h2><span>{myRoster.length}/15</span></div>
            {(["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BENCH"] as const).map((slot) => {
              const picks = myRoster.filter((pick) => pick.rosterSlot === slot);
              return (
                <div className="roster-slot" key={slot}>
                  <span>{slot}</span>
                  <div>{picks.length ? picks.map((pick) => <strong key={pick.overall}>{pick.player.name}</strong>) : <em>Open</em>}</div>
                </div>
              );
            })}
          </section>

          <section className="panel settings">
            <div className="panel-heading"><h2>Strategy</h2></div>
            {(["chenRank", "tierCliff", "positionalNeed", "turnUrgency"] as const).map((key) => (
              <label key={key}>
                <span>{key.replace(/([A-Z])/g, " $1")} <b>{state.weights[key]}</b></span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={state.weights[key]}
                  onChange={(event) =>
                    setState((previous) => ({
                      ...previous,
                      weights: { ...previous.weights, [key]: Number(event.target.value) },
                    }))
                  }
                />
              </label>
            ))}
            <button
              className="secondary reset-weights"
              onClick={() =>
                setState((previous) => ({
                  ...previous,
                  weights: DEFAULT_STRATEGY_WEIGHTS,
                }))
              }
            >
              Reset weights to defaults
            </button>
            <p className="panel-hint">
              Weights, pins, and avoids are yours alone — they don&apos;t change
              what your league-mates see.
            </p>
          </section>

          {adminView && (
            <section className="panel admin-console">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Only you see this</p>
                  <h2>League admin</h2>
                </div>
                <span>
                  {pendingCount
                    ? `${pendingCount} awaiting approval`
                    : "all members approved"}
                </span>
              </div>

              <div className="admin-section">
                <p className="admin-label">Members</p>
                {adminUsers.map((user) => (
                  <div className="admin-member" key={user.id}>
                    <div className="admin-member-head">
                      <strong>{user.displayName}</strong>
                      <span className={`member-status ${user.status}`}>
                        {user.role === "admin" ? "admin" : user.status}
                      </span>
                      {user.status === "pending" ? (
                        <button onClick={() => patchUser(user.id, { status: "active" })}>
                          Approve
                        </button>
                      ) : (
                        user.role !== "admin" && (
                          <button
                            className="secondary"
                            onClick={() => patchUser(user.id, { status: "pending" })}
                          >
                            Revoke
                          </button>
                        )
                      )}
                    </div>
                    <div className="admin-member-fields">
                      <label>
                        Slot
                        <select
                          value={user.draftSlot ?? ""}
                          onChange={(event) =>
                            patchUser(user.id, {
                              draftSlot: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        >
                          <option value="">—</option>
                          {Array.from({ length: 12 }, (_, index) => (
                            <option key={index + 1} value={index + 1}>
                              {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Team
                        <input
                          type="text"
                          defaultValue={user.teamName ?? ""}
                          placeholder="Team name"
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value !== (user.teamName ?? "")) {
                              patchUser(user.id, { teamName: value || null });
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {adminUsers.length <= 1 && (
                  <p className="admin-hint">
                    Friends show up here after they sign in with Yahoo.
                    Approve them to unlock the board.
                  </p>
                )}
              </div>

              <div className="admin-section">
                <p className="admin-label">Mock harness &amp; live sync</p>
                <div className="sync-panel">
                  <label>
                    League key
                    <input
                      type="text"
                      placeholder="mock.abc123 or 461.l.12345"
                      value={leagueKey}
                      onChange={(event) => setLeagueKey(event.target.value)}
                    />
                  </label>
                  <label>
                    Poll every
                    <select
                      value={syncIntervalSec}
                      onChange={(event) => setSyncIntervalSec(Number(event.target.value))}
                    >
                      {[3, 5, 8, 15, 30].map((value) => (
                        <option key={value} value={value}>
                          {value}s
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sync-actions">
                    <button className="secondary" onClick={startMockHarness}>
                      Start mock harness
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        if (!leagueKey.trim()) return;
                        await fetch(
                          `/api/yahoo/mock?leagueKey=${encodeURIComponent(leagueKey.trim())}`,
                          { method: "DELETE" },
                        );
                        setNotice(`Stopped mock ${leagueKey}.`);
                        setSyncStatus("idle");
                      }}
                    >
                      Stop mock
                    </button>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={syncPaused}
                      onChange={(event) => setSyncPaused(event.target.checked)}
                    />
                    Pause live synchronization
                  </label>
                  <p className="sync-status">Status: {syncStatus}</p>
                </div>
              </div>
            </section>
          )}

          <section className="panel exports">
            <button className="secondary" onClick={() => download("draft-results.json", JSON.stringify(state.draft, null, 2), "application/json")}>
              Export JSON
            </button>
            <button className="secondary" onClick={() => download("draft-results.csv", toCsv(state), "text/csv")}>
              Export CSV
            </button>
          </section>
        </aside>
      </section>

      <section className="panel board">
        <div className="panel-heading">
          <div><p className="eyebrow">All selections</p><h2>Draft board</h2></div>
          <span>Last local update {state.draft.picks.at(-1)?.madeAt ? new Date(state.draft.picks.at(-1)!.madeAt!).toLocaleTimeString() : "—"}</span>
        </div>
        <div className="board-grid">
          {Array.from({ length: 12 }, (_, index) => (
            <div className={`board-team ${index + 1 === state.draft.userSlot ? "mine" : ""}`} key={index}>
              <strong>{teamLabel(index + 1)}</strong>
              {state.draft.picks
                .filter((pick) => pick.slot === index + 1)
                .map((pick) => (
                  <div className={`board-pick pos-${pick.player.position.toLowerCase()}`} key={pick.overall}>
                    <span>{pick.round}.{pick.slot}</span>
                    <b>{pick.player.name}</b>
                    <small>{pick.player.position}</small>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
