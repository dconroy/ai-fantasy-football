"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Scoring = "standard" | "half-ppr" | "ppr";

interface DemoRoom {
  id: string;
  name: string;
  totalSeats: number;
  activeSeats: number;
  openSeats: number;
  openSeatList: number[];
  scoring: Scoring;
  rounds: number;
  picks: number;
  totalPicks: number;
  started: boolean;
  complete: boolean;
}

interface RoomsResponse {
  rooms: DemoRoom[];
  activePlayers: number;
}

interface CreatedDraft {
  roomId: string;
  slot: number;
}

const SCORING_LABELS: Record<Scoring, string> = {
  standard: "Standard",
  "half-ppr": "Half PPR",
  ppr: "Full PPR",
};

function invitePath(roomId: string) {
  return `/demo?room=${encodeURIComponent(roomId)}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function DemoLobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<DemoRoom[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [seats, setSeats] = useState<Record<string, number>>({});
  const [scoring, setScoring] = useState<Scoring>("half-ppr");
  const [teamCount, setTeamCount] = useState(12);
  const [rounds, setRounds] = useState(15);
  const [slot, setSlot] = useState(1);
  const [created, setCreated] = useState<CreatedDraft | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/demo/rooms", { cache: "no-store" });
        const body = (await response.json()) as RoomsResponse;
        if (!cancelled && response.ok) {
          setRooms(body.rooms);
          setSeats((previous) => {
            const next = { ...previous };
            for (const room of body.rooms) {
              if (!room.openSeatList.includes(next[room.id])) {
                next[room.id] = room.openSeatList[0] ?? 1;
              }
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (slot > teamCount) setSlot(teamCount);
  }, [slot, teamCount]);

  const slotOptions = useMemo(
    () => Array.from({ length: teamCount }, (_, index) => index + 1),
    [teamCount],
  );
  const joinableCount = rooms.filter((room) => !room.complete).length;

  async function joinRoom(room: DemoRoom) {
    const requestedSlot = seats[room.id] ?? room.openSeatList[0];
    if (!requestedSlot) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/demo/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, slot: requestedSlot }),
      });
      const body = (await response.json()) as {
        error?: string;
        demo?: { roomId: string };
      };
      if (!response.ok || !body.demo?.roomId) {
        setNotice(body.error ?? "That seat is no longer available.");
        return;
      }
      router.push(invitePath(body.demo.roomId));
    } catch {
      setNotice("Could not join that draft. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoring, teamCount, rounds, slot }),
      });
      const body = (await response.json()) as {
        error?: string;
        demo?: { roomId: string; slot: number };
      };
      if (!response.ok || !body.demo?.roomId) {
        setNotice(body.error ?? "Could not create the draft.");
        return;
      }
      setCreated({ roomId: body.demo.roomId, slot: body.demo.slot });
    } catch {
      setNotice("Could not create the draft. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!created) return;
    const url = `${window.location.origin}${invitePath(created.roomId)}`;
    try {
      await copyText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy failed — select the link below instead.");
    }
  }

  if (created) {
    const path = invitePath(created.roomId);
    const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    return (
      <main className="demo-lobby">
        <section className="demo-share-card">
          <p className="eyebrow">Your draft is ready</p>
          <h1>Invite your league-mates.</h1>
          <p>
            You have slot {created.slot}. Share this unique link so everyone else
            can choose an open seat in your setup.
          </p>
          <label>
            Invite link
            <input value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="demo-share-actions">
            <button type="button" onClick={() => void copyInvite()}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => router.push(path)}
            >
              Enter draft
            </button>
          </div>
          {notice && <p className="demo-lobby-notice">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="demo-lobby">
      <header className="demo-lobby-header">
        <Link className="brand-lockup" href="/">
          <Image
            className="brand-mark"
            src="/dojo-mark.png"
            alt="Draft Dojo"
            width={58}
            height={58}
            priority
          />
          <span className="brand-copy">
            <span className="brand-tagline">Public mock drafts</span>
            <strong>Draft Dojo</strong>
          </span>
        </Link>
        <Link href="/">Home</Link>
      </header>

      <section className="demo-lobby-intro">
        <p className="eyebrow">Demo draft lobby</p>
        <h1>Join a live room or build your own.</h1>
        <p>
          Pick an open seat in a public mock, or choose the scoring, roster count,
          rounds, and draft slot for a new one.
        </p>
      </section>

      {notice && <p className="demo-lobby-notice">{notice}</p>}

      <div className="demo-lobby-grid">
        <section className="demo-lobby-panel demo-rooms-panel">
          <div className="demo-lobby-panel-head">
            <div>
              <p className="eyebrow">Live now</p>
              <h2>Open drafts</h2>
            </div>
            <span>{joinableCount} joinable</span>
          </div>
          {!loaded ? (
            <p className="demo-lobby-empty">Checking for open drafts…</p>
          ) : rooms.length === 0 ? (
            <p className="demo-lobby-empty">
              No open drafts yet. Create one and invite the first group.
            </p>
          ) : (
            <ul className="demo-room-list">
              {rooms.map((room) => (
                <li
                  className={`demo-room-card${room.complete ? " complete" : ""}`}
                  key={room.id}
                >
                  <div className="demo-room-main">
                    <strong>
                      {SCORING_LABELS[room.scoring]}
                      {room.complete ? " · Draft complete" : ""}
                    </strong>
                    <span>
                      {room.totalSeats} teams · {room.rounds} rounds
                    </span>
                    <span>
                      {room.complete
                        ? `${room.totalPicks} of ${room.totalPicks} picks made`
                        : `${room.activeSeats} seated · ${room.openSeats} open · pick ${Math.min(room.picks + 1, room.totalPicks)}`}
                    </span>
                  </div>
                  <div className="demo-room-actions">
                    {!room.complete && (
                      <label>
                        Seat
                        <select
                          value={seats[room.id] ?? room.openSeatList[0] ?? ""}
                          onChange={(event) =>
                            setSeats((previous) => ({
                              ...previous,
                              [room.id]: Number(event.target.value),
                            }))
                          }
                        >
                          {room.openSeatList.map((openSlot) => (
                            <option key={openSlot} value={openSlot}>
                              Slot {openSlot}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={busy || room.complete || room.openSeatList.length === 0}
                      onClick={() => void joinRoom(room)}
                    >
                      {room.complete ? "Complete" : "Join"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="demo-lobby-panel demo-create-panel">
          <p className="eyebrow">New room</p>
          <h2>Set up a draft</h2>
          <form onSubmit={(event) => void createRoom(event)}>
            <label>
              Scoring
              <select
                value={scoring}
                onChange={(event) => setScoring(event.target.value as Scoring)}
              >
                <option value="standard">Standard</option>
                <option value="half-ppr">Half PPR</option>
                <option value="ppr">Full PPR</option>
              </select>
            </label>
            <label>
              Rosters
              <select
                value={teamCount}
                onChange={(event) => setTeamCount(Number(event.target.value))}
              >
                {[8, 10, 12, 14].map((count) => (
                  <option key={count} value={count}>
                    {count} teams
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rounds
              <select
                value={rounds}
                onChange={(event) => setRounds(Number(event.target.value))}
              >
                {[10, 12, 14, 15, 16].map((count) => (
                  <option key={count} value={count}>
                    {count} rounds
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your slot
              <select
                value={slot}
                onChange={(event) => setSlot(Number(event.target.value))}
              >
                {slotOptions.map((option) => (
                  <option key={option} value={option}>
                    Slot {option}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create public draft"}
            </button>
          </form>
          <p className="demo-create-note">
            You will get a unique invite link. Robots fill empty seats, and friends
            can join while the draft is running.
          </p>
        </section>
      </div>
    </main>
  );
}
