"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [houseUnlocked, setHouseUnlocked] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [yahooError, setYahooError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioPlayCount = useRef(1);

  const playAudio = useCallback(async (unmuted = true) => {
    const audio = audioRef.current;
    if (!audio) return false;
    try {
      audio.muted = !unmuted;
      if (unmuted) audio.volume = 1;
      await audio.play();
      setAudioBlocked(!unmuted);
      return unmuted;
    } catch {
      setAudioBlocked(true);
      return false;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yahoo") === "denied") {
      setYahooError(
        params.get("message")
          ? `Yahoo denied access: ${params.get("message")}`
          : "Yahoo authorization was cancelled. Approve the Yahoo prompt — do not hit Cancel.",
      );
    }
    if (params.get("yahoo") === "error") {
      setYahooError(params.get("message") ?? "Yahoo authorization failed.");
    }
    if (params.get("step") === "yahoo") setHouseUnlocked(true);

    fetch("/api/auth/gate")
      .then((response) => response.json())
      .then((body: { house?: boolean }) => {
        if (body.house) setHouseUnlocked(true);
      })
      .catch(() => undefined);

    audioPlayCount.current = 1;
    const removeUnlockListeners = () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("pointermove", unlockAudio);
      window.removeEventListener("pointerenter", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    const unlockAudio = () => {
      void playAudio(true).then((played) => {
        if (played) removeUnlockListeners();
      });
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("pointermove", unlockAudio);
    window.addEventListener("pointerenter", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    void playAudio(false).then(() => undefined);
    void playAudio(true).then((played) => {
      if (played) removeUnlockListeners();
    });
    return removeUnlockListeners;
  }, [playAudio]);

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
      setHouseUnlocked(true);
      setPassword("");
      setLoading(false);
      return;
    }
    setError(true);
    setPassword("");
    setLoading(false);
  }

  const denied = error || Boolean(yahooError);

  return (
    <main className="security-screen" onMouseEnter={() => void playAudio(true)}>
      <section className={`security-console ${denied ? "denied" : ""}`}>
        <div className="security-scanline" />
        <audio
          ref={audioRef}
          src="/media/magic-word"
          autoPlay
          muted
          preload="auto"
          onMouseEnter={() => void playAudio(true)}
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
          onMouseEnter={() => void playAudio(true)}
        />
        <div className="security-emblem" aria-hidden="true">
          <span>AI</span>
          <i />
        </div>
        <p className="security-kicker">Full Contact Security System</p>
        <h1>{denied ? "Uh uh uh!" : houseUnlocked ? "Identify yourself" : "Restricted system"}</h1>
        <p className="security-message">
          {yahooError ??
            (error
              ? "You forgot the magic word."
              : houseUnlocked
                ? "Magic word accepted. Sign in with Yahoo so we know which seat is yours."
                : "Say the magic word before Yahoo will even look at you.")}
        </p>
        {audioBlocked && (
          <button
            className="security-audio"
            type="button"
            onClick={() => {
              audioPlayCount.current = 1;
              void playAudio();
            }}
          >
            Enable security audio
          </button>
        )}
        {houseUnlocked ? (
          <a className="yahoo-login" href="/api/yahoo/auth">
            Continue with Yahoo
          </a>
        ) : (
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
        )}
        <small>Unauthorized roster tinkering will be mocked by the machine.</small>
      </section>
    </main>
  );
}
