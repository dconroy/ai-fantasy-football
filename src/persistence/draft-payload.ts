import type { User } from "@prisma/client";
import type { DemoClaims } from "@/auth/demo-session";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  draftStateFor,
  getOrCreateLeagueDraft,
  listMemberSeats,
  userPrefs,
} from "@/persistence/league-draft";
import { demoClientState } from "@/persistence/demo-rooms";

export async function boardPayload(
  draftId: string,
  user: User | null,
  demo: DemoClaims | null,
) {
  const shared = await getOrCreateLeagueDraft(draftId);
  if (demo) {
    const slot = demo.slot ?? 0;
    return {
      ...shared,
      draft: draftStateFor(shared, slot),
      members: [],
      me: {
        id: "demo",
        displayName: demo.role === "play" ? `Seat ${slot}` : "Spectator",
        role: "member" as const,
        draftSlot: slot,
        teamName: demo.role === "play" ? `Seat ${slot}` : "Watching",
        pins: [] as string[],
        avoids: [] as string[],
        weights: DEFAULT_STRATEGY_WEIGHTS,
        darkMode: true,
      },
      demo: {
        role: demo.role,
        slot: demo.slot,
        roomId: demo.roomId,
        ...(await demoClientState(draftId)),
      },
    };
  }
  if (!user) throw new Error("Authentication required");
  const prefs = userPrefs(user);
  const members = await listMemberSeats(draftId);
  return {
    ...shared,
    draft: draftStateFor(shared, prefs.draftSlot),
    members,
    me: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      ...prefs,
    },
  };
}
