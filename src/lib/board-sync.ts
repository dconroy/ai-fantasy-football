import type { Player } from "@/domain";

/** Fingerprint for the player list — picks can change without this moving. */
export function playerRevision(importedAt: string, source: string): string {
  return `${importedAt}\t${source}`;
}

export function isDraftPoll(query: {
  readonly since?: string | null;
  readonly playersRev?: string | null;
}): boolean {
  return Boolean(query.since || query.playersRev);
}

export function mergePollPlayers(
  current: readonly Player[],
  payload: {
    players?: readonly Player[] | null;
    playersOmitted?: boolean;
    unchanged?: boolean;
  },
): readonly Player[] {
  if (payload.unchanged || payload.playersOmitted || !payload.players) {
    return current;
  }
  return payload.players;
}
