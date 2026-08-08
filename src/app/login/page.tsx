"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioPlayCount = useRef(1);

  useEffect(() => {
    audioPlayCount.current = 1;
    audioRef.current
      ?.play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(false);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      window.location.assign("/");
      return;
    }
    setError(true);
    setPassword("");
    setLoading(false);
  }

  return (
    <main className="security-screen">
      <section className={`security-console ${error ? "denied" : ""}`}>
        <div className="security-scanline" />
        <audio
          ref={audioRef}
          src="/media/magic-word"
          autoPlay
          preload="auto"
          onEnded={() => {
            if (!audioRef.current || audioPlayCount.current >= 3) return;
            audioPlayCount.current += 1;
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => setAudioBlocked(true));
          }}
        />
        <Image
          className="newman-gif"
          src="/media/newman"
          alt="Security system says ah ah ah"
          width={620}
          height={402}
          unoptimized
          priority
        />
        <div className="security-emblem" aria-hidden="true">
          <span>AI</span>
          <i />
        </div>
        <p className="security-kicker">Full Contact Security System</p>
        <h1>{error ? "Uh uh uh!" : "Restricted system"}</h1>
        <p className="security-message">
          {error
            ? "You forgot the magic word."
            : "Conroy’s AI requires authorization before league destruction can commence."}
        </p>
        {audioBlocked && (
          <button
            className="security-audio"
            type="button"
            onClick={() => {
              audioPlayCount.current = 1;
              audioRef.current?.play();
              setAudioBlocked(false);
            }}
          >
            Enable security audio
          </button>
        )}
        <form onSubmit={submit}>
          <label htmlFor="access-password">Magic word</label>
          <input
            id="access-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
          />
          <button disabled={loading || !password}>
            {loading ? "Checking credentials…" : "Access command center"}
          </button>
        </form>
        <small>Unauthorized roster tinkering will be mocked by the machine.</small>
      </section>
    </main>
  );
}
