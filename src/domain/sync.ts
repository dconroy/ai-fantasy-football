export interface SyncRevision {
  /** Monotonically increasing revision from the upstream draft provider. */
  readonly sequence: number;
  /** ISO timestamp used only as a tie-breaker for providers that reuse revisions. */
  readonly updatedAt?: string;
}

/**
 * Rejects stale and duplicate updates. Adapters should keep the last applied
 * revision and call this before replacing local draft state.
 */
export function shouldApplySyncUpdate(
  current: SyncRevision | null,
  incoming: SyncRevision,
): boolean {
  if (!Number.isInteger(incoming.sequence) || incoming.sequence < 0) return false;
  if (!current) return true;
  if (incoming.sequence !== current.sequence) return incoming.sequence > current.sequence;
  if (!incoming.updatedAt || !current.updatedAt) return false;
  const incomingTime = Date.parse(incoming.updatedAt);
  const currentTime = Date.parse(current.updatedAt);
  return Number.isFinite(incomingTime) && incomingTime > currentTime;
}

export function createStaleSyncGuard(initial: SyncRevision | null = null): {
  readonly current: () => SyncRevision | null;
  readonly accept: (incoming: SyncRevision) => boolean;
} {
  let lastApplied = initial;
  return {
    current: () => lastApplied,
    accept: (incoming) => {
      if (!shouldApplySyncUpdate(lastApplied, incoming)) return false;
      lastApplied = incoming;
      return true;
    },
  };
}
