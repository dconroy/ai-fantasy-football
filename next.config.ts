import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function git(command: string) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const gitSha = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  git("git rev-parse HEAD") ||
  "dev"
).slice(0, 7);
const builtAt = new Date().toISOString();

process.env.NEXT_PUBLIC_GIT_SHA = gitSha;
process.env.NEXT_PUBLIC_BUILT_AT = builtAt;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_SHA: gitSha,
    NEXT_PUBLIC_BUILT_AT: builtAt,
  },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/*": [
      "./newman.gif",
      "./didn't-say-the-magic-word-made-with-Voicemod.mp3",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/dconroy/ai-fantasy-football/**",
      },
      // Yahoo player headshots are served from the *.yimg.com CDN.
      { protocol: "https", hostname: "**.yimg.com" },
      // Sleeper hosts free team logos (used for defense "headshots").
      { protocol: "https", hostname: "sleepercdn.com" },
    ],
  },
};

export default nextConfig;
