import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Draft Dojo",
  description: "Recalculates your top five after every pick.",
};

export default function LandingPage() {
  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <header className="landing-nav">
        <span className="landing-mark">Draft Dojo</span>
        <nav>
          <Link href="/demo">Demo</Link>
          <Link href="/login">Connect your league</Link>
        </nav>
      </header>
      <section className="landing-hero">
        <p className="eyebrow">dojo.football</p>
        <h1>Draft Dojo</h1>
        <p className="landing-line">Recalculates your top five after every pick.</p>
        <p className="landing-attitude">Strike first. Draft smart.</p>
        <div className="landing-ctas">
          <Link className="landing-primary" href="/demo">
            Try a live demo
          </Link>
          <Link className="landing-secondary" href="/login">
            Connect your league
          </Link>
        </div>
      </section>
      <figure className="landing-shot">
        <div className="landing-board" aria-hidden="true">
          <div>
            <p>Top five</p>
            <ol>
              <li>1 · Best available at your seat</li>
              <li>2 · Tier cliff + need</li>
              <li>3 · Scarcity into the turn</li>
              <li>4 · ADP vs the clock</li>
              <li>5 · Roster balance</li>
            </ol>
          </div>
          <div>
            <p>On the clock</p>
            <strong>Recalculates after every pick.</strong>
          </div>
        </div>
      </figure>
      <section className="landing-modes">
        <article>
          <h2>Practice mock</h2>
          <p>Robots fill empty seats. The room pauses at every human slot.</p>
        </article>
        <article>
          <h2>Watch a live draft</h2>
          <p>Follow Sleeper or Yahoo. The board updates; you still click in the app.</p>
        </article>
        <article>
          <h2>Report card</h2>
          <p>When the board fills, every team gets graded on a curve.</p>
        </article>
      </section>
      <footer className="landing-foot">
        You still make the pick in Sleeper or Yahoo. Not affiliated with Yahoo, Sleeper,
        or any ranking publisher.
      </footer>
    </main>
  );
}
