/** Stable identity for unfilled demo seats — never "T6" / "Seat 5". */
const RP_BOT_NAMES = [
  "Atlas",
  "Bolt",
  "Cipher",
  "Drift",
  "Echo",
  "Flux",
  "Gyro",
  "Helix",
  "Ion",
  "Jolt",
  "Kite",
  "Lynx",
  "Moss",
  "Nova",
] as const;

export type DemoSeatKind = "human" | "rp-bot" | "open";

export function rpBotTeamName(slot: number): string {
  const index = Math.max(0, slot - 1);
  const name = RP_BOT_NAMES[index % RP_BOT_NAMES.length];
  return `RP Bot ${name}`;
}

export function humanTeamFallback(): string {
  return "Human";
}

export function demoSeatKind(
  slot: number,
  humanSlots: Iterable<number>,
  options: { started: boolean; complete?: boolean } = { started: true },
): DemoSeatKind {
  const humans = humanSlots instanceof Set ? humanSlots : new Set(humanSlots);
  if (humans.has(slot)) return "human";
  if (options.complete || options.started) return "rp-bot";
  return "open";
}

export function demoSeatKindLabel(kind: DemoSeatKind): string {
  if (kind === "human") return "Human";
  if (kind === "rp-bot") return "RP Bot";
  return "Open";
}
