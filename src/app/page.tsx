import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { LiveRooms } from "./live-rooms";

export const metadata: Metadata = {
  title: "Draft Dojo",
  description: "Recalculates your top five after every pick.",
};

const topFive = [
  { rank: 1, name: "Bijan Robinson", pos: "RB", team: "ATL", tier: "Tier 1", note: "Best available at your seat", move: "up", imageUrl: "https://sleepercdn.com/content/nfl/players/9509.jpg" },
  { rank: 2, name: "Ja'Marr Chase", pos: "WR", team: "CIN", tier: "Tier 1", note: "Tier cliff — grab now", move: "up", imageUrl: "https://sleepercdn.com/content/nfl/players/7564.jpg" },
  { rank: 3, name: "Breece Hall", pos: "RB", team: "NYJ", tier: "Tier 2", note: "Scarcity into the turn", move: "same", imageUrl: "https://sleepercdn.com/content/nfl/players/8155.jpg" },
  { rank: 4, name: "Puka Nacua", pos: "WR", team: "LAR", tier: "Tier 2", note: "ADP vs the clock", move: "down", imageUrl: "https://sleepercdn.com/content/nfl/players/9493.jpg" },
  { rank: 5, name: "Sam LaPorta", pos: "TE", team: "DET", tier: "Tier 2", note: "Roster balance", move: "up", imageUrl: "https://sleepercdn.com/content/nfl/players/10859.jpg" },
] as const;

const modes = [
  {
    title: "Practice mock",
    body: "Robots fill the empty seats and the room pauses on every human pick. Draft as slow or as fast as you want.",
  },
  {
    title: "Watch a live draft",
    body: "Follow along on Sleeper or Yahoo. The board tracks every pick in real time — you still click in your app.",
  },
  {
    title: "Report card",
    body: "When the board fills, every team gets graded on a curve. Bragging rights, delivered.",
  },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <div className="landing-grid" aria-hidden="true" />

      <header className="landing-nav">
        <span className="landing-mark">
          <span className="landing-mark-dot" aria-hidden="true" />
          Draft&nbsp;Dojo
        </span>
        <nav>
          <Link href="/demo">Demo</Link>
          <Link className="landing-nav-cta" href="/login">
            Connect your league
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-live" aria-hidden="true" />
            dojo.football
          </p>
          <h1>
            Draft like the<br />
            room can&apos;t.
          </h1>
          <p className="landing-line">Recalculates your top five after every pick.</p>
          <p className="landing-attitude">Strike first. Draft smart.</p>
          <div className="landing-ctas">
            <Link className="landing-primary" href="/demo">
              Try a live demo
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="landing-secondary" href="/login">
              Connect your league
            </Link>
          </div>
          <p className="landing-trust">
            Sleeper &amp; Yahoo · No signup for the demo
          </p>
          <LiveRooms />
        </div>

        <figure className="landing-shot">
          <div className="landing-board">
            <div className="landing-board-head">
              <span className="landing-clock">
                <span className="landing-clock-dot" aria-hidden="true" />
                On the clock · Pick 1.07
              </span>
              <span className="landing-board-tag">Recalculated</span>
            </div>
            <p className="landing-board-title">Your top five</p>
            <ol className="landing-picks">
              {topFive.map((p) => (
                <li key={p.rank} className={`landing-pick move-${p.move}`}>
                  <span className="landing-rank">{p.rank}</span>
                  <Image
                    className="landing-player-photo"
                    src={p.imageUrl}
                    alt=""
                    width={38}
                    height={38}
                    unoptimized
                  />
                  <span className="landing-pick-main">
                    <span className="landing-pick-name">{p.name}</span>
                    <span className="landing-pick-note">{p.note}</span>
                  </span>
                  <span className="landing-pick-meta">
                    <span className={`landing-pos pos-${p.pos}`}>{p.pos}</span>
                    <span className="landing-team">{p.team}</span>
                  </span>
                  <span className={`landing-move move-${p.move}`} aria-hidden="true">
                    {p.move === "up" ? "▲" : p.move === "down" ? "▼" : "—"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </figure>
      </section>

      <section className="landing-modes">
        {modes.map((m) => (
          <article key={m.title}>
            <h2>{m.title}</h2>
            <p>{m.body}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot">
        You still make the pick in Sleeper or Yahoo. Not affiliated with Yahoo, Sleeper,
        or any ranking publisher.
      </footer>
    </main>
  );
}
