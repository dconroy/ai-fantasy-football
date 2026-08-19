export function buildStamp(): { sha: string; builtAt: string; label: string } {
  const sha = (
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "dev"
  ).slice(0, 7);
  const builtAt = process.env.NEXT_PUBLIC_BUILT_AT || "";
  const label = builtAt
    ? new Date(builtAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "local";
  return { sha, builtAt, label };
}
