"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface LineupPlayerDto {
  id: string;
  name: string;
  position: string;
  team: string;
  selectedSlot: string;
  chenRank?: number;
  chenTier?: number;
  byeWeek?: number;
  status?: string;
}

interface WeeklyData {
  league: { leagueKey: string; name: string; currentWeek?: number };
  team: { teamKey: string; name: string };
  roster: LineupPlayerDto[];
  lineup: {
    starters: Array<{ slot: string; player: LineupPlayerDto | null }>;
    bench: LineupPlayerDto[];
    moves: Array<{
      slot: string;
      start: LineupPlayerDto;
      bench?: LineupPlayerDto;
      reason: string;
    }>;
    alerts: Array<{ severity: "critical" | "warning"; message: string }>;
  };
  matchup: {
    week?: number;
    status?: string;
    teams: Array<{
      teamKey: string;
      name: string;
      points?: number;
      projectedPoints?: number;
    }>;
  } | null;
  standings: Array<{
    rank: number;
    teamKey: string;
    name: string;
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
  }>;
  transactions: Array<{
    key: string;
    type: string;
    timestamp?: number;
    players: Array<{
      name: string;
      position?: string;
      moveType: string;
      sourceTeamName?: string;
      destinationTeamName?: string;
    }>;
  }>;
  waivers: Array<{
    playerKey: string;
    name: string;
    position: string;
    team: string;
    status?: string;
    byeWeek?: number;
    percentOwned?: number;
    chenRank?: number;
    chenTier?: number;
  }>;
  chen: { importedAt: string; source: string };
  syncedAt: string;
}

interface LeagueOption {
  leagueKey: string;
  name: string;
  season?: number;
  numTeams?: number;
}

function slotLabel(slot: string) {
  if (slot === "W/R/T" || slot === "W/R" || slot === "W/T" || slot === "Q/W/R/T") {
    return "FLEX";
  }
  if (slot === "BN") return "Bench";
  return slot;
}

function playerBadge(player: LineupPlayerDto, currentWeek?: number) {
  if (currentWeek !== undefined && player.byeWeek === currentWeek) return "BYE";
  return player.status?.toUpperCase() ?? null;
}

function badgeClass(badge: string) {
  if (badge === "Q") return "player-badge warn";
  return "player-badge critical";
}

export function WeeklyHq() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [leagues, setLeagues] = useState<LeagueOption[] | null>(null);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/weekly", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setData(null);
        setError({
          code: typeof body?.error === "string" ? body.error : "failed",
          message: body?.message ?? body?.error ?? `HTTP ${response.status}`,
        });
      } else {
        setData(body as WeeklyData);
      }
    } catch (fetchError) {
      setData(null);
      setError({
        code: "network",
        message: fetchError instanceof Error ? fetchError.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me: { darkMode?: boolean; role?: string } | null) => {
        if (me) {
          setDark(me.darkMode === true);
          setIsAdmin(me.role === "admin");
        }
      })
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (error?.code !== "no-league" || leagues !== null) return;
    fetch("/api/yahoo/leagues")
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Unable to list leagues");
        setLeagues((body?.leagues ?? []) as LeagueOption[]);
      })
      .catch((listError: Error) => setLeaguesError(listError.message));
  }, [error, leagues]);

  async function connectLeague(leagueKey: string) {
    await fetch("/api/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leagueKey", leagueKey }),
    });
    await load();
  }

  const week = data?.league.currentWeek;
  const currentStarters = data?.roster.filter(
    (player) => player.selectedSlot !== "BN" && player.selectedSlot !== "IR",
  );
  const benchPlayers = data?.roster.filter(
    (player) => player.selectedSlot === "BN" || player.selectedSlot === "IR",
  );
  const myMatchupTeam = data?.matchup?.teams.find(
    (team) => team.teamKey === data.team.teamKey,
  );
  const opponent = data?.matchup?.teams.find(
    (team) => team.teamKey !== data.team.teamKey,
  );

  return (
    <main className={dark ? "app dark" : "app"}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-copy">
            <p className="eyebrow">
              {data ? `${data.league.name} · Week ${week ?? "—"}` : "Full Contact · 2026"}
            </p>
            <h1>Weekly HQ</h1>
            <p className="brand-tagline">
              Start smart. Stream smarter. All moves stay manual in Yahoo.
            </p>
          </div>
        </div>
        <div className="status-row">
          <Link className="status" href="/">Draft board</Link>
          <button className="icon-button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="icon-button"
            onClick={() => {
              const next = !dark;
              setDark(next);
              void fetch("/api/me", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ darkMode: next }),
              });
            }}
          >
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {loading && !data && <div className="notice">Loading weekly data from Yahoo…</div>}

      {error && error.code === "no-league" && (
        <section className="panel weekly-setup">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">One-time setup</p>
              <h2>Connect your Yahoo league</h2>
            </div>
          </div>
          <div className="weekly-setup-body">
            {isAdmin ? (
              <>
                <p>
                  Pick your league below. This is saved for the whole draft room, so
                  everyone gets their own roster and matchup automatically.
                </p>
                {leaguesError && <p className="weekly-error">{leaguesError}</p>}
                {leagues === null && !leaguesError && <p>Loading your Yahoo leagues…</p>}
                {leagues?.map((league) => (
                  <button
                    key={league.leagueKey}
                    className="secondary"
                    onClick={() => void connectLeague(league.leagueKey)}
                  >
                    {league.name}
                    {league.season ? ` · ${league.season}` : ""}
                    {league.numTeams ? ` · ${league.numTeams} teams` : ""}
                  </button>
                ))}
                {leagues?.length === 0 && (
                  <p>Yahoo returned no NFL leagues for your account.</p>
                )}
              </>
            ) : (
              <p>No Yahoo league is connected yet — ask your admin to set it up.</p>
            )}
          </div>
        </section>
      )}

      {error && error.code !== "no-league" && (
        <section className="panel weekly-setup">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Yahoo sync issue</p>
              <h2>Couldn&apos;t load weekly data</h2>
            </div>
          </div>
          <div className="weekly-setup-body">
            <p className="weekly-error">{error.message}</p>
            <button className="secondary" onClick={() => void load()}>Try again</button>
          </div>
        </section>
      )}

      {data && (
        <>
          {data.lineup.alerts.length > 0 && (
            <div className="alert-stack">
              {data.lineup.alerts.map((alert) => (
                <div className={`lineup-alert ${alert.severity}`} key={alert.message}>
                  {alert.severity === "critical" ? "⛔" : "⚠️"} {alert.message}
                </div>
              ))}
            </div>
          )}

          <section className="workspace weekly-grid">
            <aside className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Chen-ranked · advisory only</p>
                  <h2>Optimal lineup</h2>
                </div>
                <span>Week {week ?? "—"}</span>
              </div>
              {data.lineup.starters.map((entry, index) => (
                <div className="weekly-slot" key={`${entry.slot}-${index}`}>
                  <span className="weekly-slot-label">{entry.slot}</span>
                  {entry.player ? (
                    <div className="weekly-slot-player">
                      <strong>{entry.player.name}</strong>
                      <small>
                        {entry.player.position} · {entry.player.team}
                        {entry.player.chenTier ? ` · T${entry.player.chenTier}` : ""}
                      </small>
                    </div>
                  ) : (
                    <em>No one available</em>
                  )}
                  {entry.player &&
                    (entry.player.selectedSlot === "BN" ? (
                      <span className="swap-badge">SWAP IN</span>
                    ) : null)}
                </div>
              ))}
              {data.lineup.moves.length > 0 ? (
                <div className="weekly-moves">
                  <p className="admin-label">Suggested moves</p>
                  {data.lineup.moves.map((move) => (
                    <p key={`${move.slot}-${move.start.id}`}>
                      <strong>
                        Start {move.start.name}
                        {move.bench ? ` over ${move.bench.name}` : ""}
                      </strong>{" "}
                      at {move.slot} — {move.reason}.
                    </p>
                  ))}
                  <p className="weekly-footnote">
                    Make these changes in the Yahoo app — this tool never edits your
                    lineup.
                  </p>
                </div>
              ) : (
                <p className="weekly-moves weekly-all-set">
                  Your current lineup already matches the optimal one.
                </p>
              )}
            </aside>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{data.team.name}</p>
                  <h2>My roster</h2>
                </div>
                <span>{data.roster.length} players</span>
              </div>
              <div className="weekly-roster">
                {[...(currentStarters ?? []), ...(benchPlayers ?? [])].map((player) => {
                  const badge = playerBadge(player, week);
                  return (
                    <div className="weekly-roster-row" key={player.id}>
                      <span className="weekly-slot-label">
                        {slotLabel(player.selectedSlot)}
                      </span>
                      <span className="weekly-roster-name">
                        <strong>{player.name}</strong>
                        <small>
                          {player.position} · {player.team} · Bye {player.byeWeek ?? "—"}
                        </small>
                      </span>
                      <span>
                        {player.chenTier ? (
                          <i className={`tier tier-${Math.min(player.chenTier, 8)}`}>
                            T{player.chenTier}
                          </i>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span>{badge && <b className={badgeClass(badge)}>{badge}</b>}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="right-column">
              {data.matchup && myMatchupTeam && opponent && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Matchup</h2>
                    <span>Week {data.matchup.week ?? week ?? "—"}</span>
                  </div>
                  <div className="weekly-matchup">
                    <div>
                      <strong>{myMatchupTeam.name}</strong>
                      <b>{myMatchupTeam.points ?? 0}</b>
                      <small>proj {myMatchupTeam.projectedPoints ?? "—"}</small>
                    </div>
                    <span>vs</span>
                    <div>
                      <strong>{opponent.name}</strong>
                      <b>{opponent.points ?? 0}</b>
                      <small>proj {opponent.projectedPoints ?? "—"}</small>
                    </div>
                  </div>
                </section>
              )}

              {data.standings.length > 0 && (
                <section className="panel">
                  <div className="panel-heading"><h2>Standings</h2></div>
                  <div className="weekly-standings">
                    {data.standings.map((row) => (
                      <div
                        className={`weekly-standings-row ${row.teamKey === data.team.teamKey ? "mine" : ""}`}
                        key={row.teamKey}
                      >
                        <span>{row.rank}</span>
                        <strong>{row.name}</strong>
                        <span>
                          {row.wins}-{row.losses}
                          {row.ties ? `-${row.ties}` : ""}
                        </span>
                        <span>{row.pointsFor.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </section>

          <section className="workspace weekly-grid-lower">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Free agents by Yahoo rank</p>
                  <h2>Waiver targets</h2>
                </div>
                <span>advisory only</span>
              </div>
              <div className="weekly-waivers">
                {data.waivers.map((agent) => (
                  <div className="weekly-roster-row" key={agent.playerKey}>
                    <span className="weekly-slot-label">{agent.position}</span>
                    <span className="weekly-roster-name">
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.team} · Bye {agent.byeWeek ?? "—"}
                        {agent.percentOwned !== undefined
                          ? ` · ${agent.percentOwned}% owned`
                          : ""}
                      </small>
                    </span>
                    <span>
                      {agent.chenTier ? (
                        <i className={`tier tier-${Math.min(agent.chenTier, 8)}`}>
                          T{agent.chenTier}
                        </i>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span>
                      {agent.status && (
                        <b className={badgeClass(agent.status)}>{agent.status}</b>
                      )}
                    </span>
                  </div>
                ))}
                {data.waivers.length === 0 && (
                  <p className="weekly-footnote">No free agent data available.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Adds, drops, and trades</p>
                  <h2>League activity</h2>
                </div>
              </div>
              <div className="weekly-activity">
                {data.transactions.map((transaction) => (
                  <div className="weekly-activity-row" key={transaction.key}>
                    <small>
                      {transaction.timestamp
                        ? new Date(transaction.timestamp * 1000).toLocaleDateString()
                        : ""}
                      {" · "}
                      {transaction.type}
                    </small>
                    {transaction.players.map((player, index) => (
                      <p key={`${transaction.key}-${index}`}>
                        {player.moveType === "add" ? "➕" : player.moveType === "drop" ? "➖" : "🔁"}{" "}
                        <strong>{player.name}</strong>
                        {player.position ? ` (${player.position})` : ""}
                        {player.moveType === "add" && player.destinationTeamName
                          ? ` → ${player.destinationTeamName}`
                          : ""}
                        {player.moveType === "drop" && player.sourceTeamName
                          ? ` ← ${player.sourceTeamName}`
                          : ""}
                      </p>
                    ))}
                  </div>
                ))}
                {data.transactions.length === 0 && (
                  <p className="weekly-footnote">No transactions yet.</p>
                )}
              </div>
            </section>
          </section>

          <p className="weekly-meta">
            Yahoo synced {new Date(data.syncedAt).toLocaleTimeString()} · Chen data{" "}
            {data.chen.importedAt} (auto-refreshes every 3 days)
          </p>
        </>
      )}
    </main>
  );
}
