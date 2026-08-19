import { buildStamp } from "@/lib/build-info";

export function BuildFooter() {
  const { sha, builtAt, label } = buildStamp();
  return (
    <footer className="build-footer">
      <span>build</span>
      <code>{sha}</code>
      <span aria-hidden="true">·</span>
      <time dateTime={builtAt || undefined}>{label}</time>
    </footer>
  );
}
