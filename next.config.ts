import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ],
  },
};

export default nextConfig;
