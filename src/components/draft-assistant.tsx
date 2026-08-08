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
  undoLastPick,
  type DraftState,
  type Player,
  type Position,
  type StrategyWeights,
} from "@/domain";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import { parseChenCsv } from "@/adapters/chen/boris-chen";
import { MOCK_PLAYERS } from "@/fixtures/mock-players";

const STORAGE_KEY = "draft-room-2026-v1";
const POSITIONS: readonly (Position | "ALL")[] = [
  "ALL", "QB", "RB", "WR", "TE", "K", "DEF",
];

interface PersistedUiState {
  mode: "mock" | "live";
  draft: DraftState;
  players: readonly Player[];
  pins: readonly string[];
  avoids: readonly string[];
  importedAt: string;
  source: string;
  weights: StrategyWeights;
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

function opponentPick(state: DraftState, players: readonly Player[]) {
  const candidates = [...availablePlayers(state, players)].sort(
    (a, b) =>
      (a.chenRank ?? Number.MAX_SAFE_INTEGER) -
      (b.chenRank ?? Number.MAX_SAFE_INTEGER),
  );
  for (const player of candidates) {
    try {
      return makeManualPick(state, player);
    } catch {
      // Try the next roster-eligible player.
    }
  }
  return state;
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
  const [autoDisabled, setAutoDisabled] = useState(true);
  const [dark, setDark] = useState(false);
  const [yahooConnected, setYahooConnected] = useState(false);
  const [notice, setNotice] = useState("Simulation ready");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    let cancelled = false;
    fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((shared: PersistedUiState | null) => {
        if (!cancelled) {
          setState(shared?.draft && shared?.players ? normalizePersisted(shared) : hydrate());
          setNotice(shared ? "Loaded shared draft state" : "Simulation ready");
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
    fetch("/api/yahoo/status")
      .then((response) => response.json())
      .then((status: { connected?: boolean }) =>
        setYahooConnected(status.connected === true),
      )
      .catch(() => setYahooConnected(false));
    const yahooResult = new URLSearchParams(window.location.search).get("yahoo");
    if (yahooResult === "connected") setNotice("Yahoo connected successfully.");
    if (yahooResult === "denied") setNotice("Yahoo authorization was cancelled.");
    if (yahooResult === "error") setNotice("Yahoo authorization failed.");
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const timeout = window.setTimeout(() => {
      fetch("/api/session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [ready, state]);

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
  const recommendationPool = useMemo(
    () => state.players.filter((player) => !state.avoids.includes(player.id)),
    [state.players, state.avoids],
  );
  const recommendation = useMemo(
    () =>
      recommendPlayers(state.draft, recommendationPool, {
        weights: state.weights,
      }),
    [state.draft, recommendationPool, state.weights],
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
      const pinDelta = Number(state.pins.includes(b.id)) - Number(state.pins.includes(a.id));
      return (
        pinDelta ||
        (a.chenRank ?? Number.MAX_SAFE_INTEGER) -
          (b.chenRank ?? Number.MAX_SAFE_INTEGER)
      );
    });

  function updateDraft(draft: DraftState, message: string) {
    setState((previous) => ({ ...previous, draft }));
    setNotice(message);
  }

  function startSession(mode: "mock" | "live") {
    if (
      state.draft.picks.length > 0 &&
      !window.confirm(
        `Clear all ${state.draft.picks.length} recorded picks and start a clean ${mode} draft?`,
      )
    ) {
      return;
    }
    setState((previous) => ({
      ...previous,
      mode,
      draft: createDraftState(previous.draft.userSlot),
    }));
    setSelected(null);
    setSyncPaused(mode === "mock");
    setAutoDisabled(true);
    setNotice(
      mode === "mock"
        ? `Joined a new local mock draft from slot ${state.draft.userSlot}.`
        : `Live board reset and ready from slot ${state.draft.userSlot}.`,
    );
  }

  function confirm(player: Player) {
    if (!isMyTurn) {
      setNotice(`Pick ${current.overall} belongs to draft slot ${current.slot}.`);
      return;
    }
    try {
      updateDraft(
        makeManualPick(state.draft, player, { madeAt: new Date().toISOString() }),
        `Confirmed ${player.name} locally. Waiting for future Yahoo reconciliation.`,
      );
      setSelected(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to record pick");
    }
  }

  function markDrafted(player: Player) {
    try {
      updateDraft(
        makeManualPick(state.draft, player, { madeAt: new Date().toISOString() }),
        `Recorded ${player.name} at pick ${current.overall}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to record pick");
    }
  }

  function simulateToTurn() {
    if (state.mode !== "mock") {
      setNotice("Simulation is disabled on the live draft board.");
      return;
    }
    let next = state.draft;
    while (
      next.picks.length < next.teamCount * next.rounds &&
      selectionForOverall(next.picks.length + 1, next.teamCount).slot !== next.userSlot
    ) {
      const advanced = opponentPick(next, state.players);
      if (advanced === next) break;
      next = advanced;
    }
    updateDraft(next, `Simulated through pick ${next.picks.length}.`);
  }

  function toggleList(key: "pins" | "avoids", id: string) {
    setState((previous) => ({
      ...previous,
      [key]: previous[key].includes(id)
        ? previous[key].filter((value) => value !== id)
        : [...previous[key], id],
    }));
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
    setState((previous) => ({
      ...previous,
      players,
      importedAt: parsed.importedAt,
      source: parsed.source,
      draft: createDraftState(previous.draft.userSlot),
      pins: [],
      avoids: [],
    }));
    setNotice(`Imported ${players.length} players; ${parsed.warnings.length} warning(s).`);
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
      setState((previous) => ({
        ...previous,
        players,
        importedAt: parsed.importedAt,
        source: parsed.source,
        draft: createDraftState(previous.draft.userSlot),
        pins: [],
        avoids: [],
      }));
      setNotice(`Loaded ${players.length} current source records.`);
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : "Chen fetch failed"}. Use manual CSV import.`,
      );
    }
  }

  const selectedPlayer =
    available.find((player) => player.id === selected) ??
    recommendation.recommendations[0]?.player;

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
            <p className="eyebrow">Full Contact · 2026 · 12-team full PPR</p>
            <h1>Conroy&apos;s AI Draft Room</h1>
            <p className="brand-tagline">Conroy&apos;s AI gonna fuck you up.</p>
          </div>
        </div>
        <div className="status-row">
          <span className={`status ${state.mode === "mock" ? "simulation" : "live"}`}>
            ● {state.mode === "mock" ? "Mock draft" : "Live board"}
          </span>
          {yahooConnected ? (
            <span className="status connected">● Yahoo connected</span>
          ) : (
            <a className="status yahoo-connect" href="/api/yahoo/auth">
              Connect Yahoo
            </a>
          )}
          <button className="icon-button" onClick={() => setDark((value) => !value)}>
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

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
        <button
          onClick={simulateToTurn}
          disabled={state.mode !== "mock" || isMyTurn}
        >
          Simulate to my pick
        </button>
        <button
          className="secondary"
          onClick={() => updateDraft(opponentPick(state.draft, state.players), "Advanced one pick.")}
          disabled={state.mode !== "mock" || isMyTurn}
        >
          Advance one
        </button>
        <button
          className="secondary"
          onClick={() => {
            updateDraft(undoLastPick(state.draft), "Undid the latest pick.");
          }}
          disabled={!state.draft.picks.length}
        >
          Undo
        </button>
        <button className="secondary" onClick={() => startSession("mock")}>
          New mock
        </button>
        <button className="live-button" onClick={() => startSession("live")}>
          Prepare live
        </button>
        <button className="danger" onClick={() => setAutoDisabled(true)}>
          Emergency disable
        </button>
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
          <p className="safety-note">Never submits to Yahoo. Auto-selection: {autoDisabled ? "OFF" : "OFF (feature unavailable)"}</p>
        </aside>

        <section className="panel available-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Chen-first rankings</p>
              <h2>Best available <span>{available.length}</span></h2>
            </div>
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
                className={`table-row ${selected === player.id ? "selected" : ""} ${state.avoids.includes(player.id) ? "avoided" : ""}`}
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
                    {state.pins.includes(player.id) ? "★" : "☆"}
                  </button>
                  <button onClick={(event) => { event.stopPropagation(); toggleList("avoids", player.id); }}>
                    {state.avoids.includes(player.id) ? "Allow" : "Avoid"}
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
            <label className="toggle">
              <input type="checkbox" checked={syncPaused} onChange={(event) => setSyncPaused(event.target.checked)} />
              Pause live synchronization
            </label>
            <label className="toggle">
              <input type="checkbox" checked={autoDisabled} onChange={(event) => setAutoDisabled(event.target.checked)} />
              Automatic behavior disabled
            </label>
          </section>

          <section className="panel exports">
            <button className="secondary" onClick={() => download("draft-results.json", JSON.stringify(state.draft, null, 2), "application/json")}>
              Export JSON
            </button>
            <button className="secondary" onClick={() => download("draft-results.csv", toCsv(state), "text/csv")}>
              Export CSV
            </button>
            <button
              className="secondary"
              onClick={() => startSession("mock")}
            >
              Reset to new mock
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
              <strong>{index + 1 === state.draft.userSlot ? "MY TEAM" : `TEAM ${index + 1}`}</strong>
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
