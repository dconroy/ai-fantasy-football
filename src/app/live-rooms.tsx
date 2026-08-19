"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Room {
  id: string;
  name: string;
  totalSeats: number;
  activeSeats: number;
  openSeats: number;
  scoring: "standard" | "half-ppr" | "ppr";
  rounds: number;
  picks: number;
  totalPicks: number;
  started: boolean;
  complete: boolean;
}

interface RoomsResponse {
  totalRooms: number;
  joinableRooms: number;
  totalOpenSeats: number;
  activePlayers: number;
  rooms: Room[];
}

function roomHref(id: string) {
  return `/demo?room=${encodeURIComponent(id)}`;
}

export function LiveRooms() {
  const [data, setData] = useState<RoomsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/demo/rooms", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Room list unavailable");
          return response.json();
        })
        .then((body: RoomsResponse | null) => {
          if (cancelled || !body) return;
          setData(body);
          setLoadError(false);
          setLoaded(true);
        })
        .catch(() => {
          if (!cancelled) {
            setLoadError(true);
            setLoaded(true);
          }
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const joinable = (data?.rooms ?? []).filter(
    (room) => !room.complete && room.openSeats > 0,
  );
  const activePlayers = data?.activePlayers ?? 0;

  return (
    <section className="live-rooms" aria-live="polite">
      <div className="live-rooms-head">
        <span className="live-rooms-pulse" aria-hidden="true" />
        <span className="live-rooms-count">
          {!loaded
            ? "Checking live drafts…"
            : loadError
              ? "Live drafts are temporarily unavailable"
            : joinable.length === 0
              ? "No live drafts right now"
              : `${joinable.length} live draft${joinable.length === 1 ? "" : "s"} · ${data?.totalOpenSeats ?? 0} open seat${data?.totalOpenSeats === 1 ? "" : "s"}`}
        </span>
        {activePlayers > 0 && (
          <span className="live-rooms-players">{activePlayers} drafting now</span>
        )}
      </div>

      {joinable.length > 0 ? (
        <ul className="live-rooms-list">
          {joinable.map((room) => (
            <li key={room.id}>
              <Link className="live-room" href={roomHref(room.id)}>
                <span className="live-room-name">{room.name}</span>
                <span className="live-room-seats">
                        {room.scoring === "half-ppr"
                          ? "Half PPR"
                          : room.scoring === "ppr"
                            ? "Full PPR"
                            : "Standard"}{" "}
                        · {room.totalSeats} teams · {room.openSeats} open
                </span>
                <span className="live-room-join">
                  {room.started ? "Drafting" : "Waiting"} · Join →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : !loadError ? (
        <p className="live-rooms-empty">
          Be the first in the dojo — start a fresh room.
        </p>
      ) : null}

      <Link className="live-rooms-cta" href="/demo">
        {joinable.length > 0 ? "Browse live drafts" : "Create a demo draft"} →
      </Link>
    </section>
  );
}
