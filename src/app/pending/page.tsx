"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function PendingPage() {
  const [name, setName] = useState("Manager");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { displayName?: string; status?: string };
      if (cancelled) return;
      if (body.displayName) setName(body.displayName);
      if (body.status === "active") window.location.assign("/");
    };
    void poll();
    const timer = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="security-screen">
      <section className="security-console">
        <div className="security-scanline" />
        <Image
          className="newman-gif"
          src="/media/newman"
          alt="Security system says ah ah ah"
          width={620}
          height={402}
          unoptimized
          priority
        />
        <p className="security-kicker">Full Contact Security System</p>
        <h1>Waiting for Conroy</h1>
        <p className="security-message">
          {name}, you signed in with Yahoo. An admin still has to approve this seat before you
          can see the board.
        </p>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="security-audio">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
