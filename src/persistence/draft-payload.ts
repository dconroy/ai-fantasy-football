import type { User } from "@prisma/client";
import type { DemoClaims } from "@/auth/demo-session";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import {
  draftStateFor,
  getOrCreateLeagueDraft,
  listMemberSeats,
  userPrefs,
} from "@/persistence/league-draft";
import {
  demoClientState,
  demoSeatMembers,
} from "@/persistence/demo-rooms";

export async function boardPayload(
  draftId: string,
  user: User | null,
  demo: DemoClaims | null,
) {
  const shared = await getOrCreateLeagueDraft(draftId);
  if (demo) {
    const slot = demo.slot ?? 0;
    const members = await demoSeatMembers(draftId);
    const member = members.find((candidate) => candidate.draftSlot === slot);
    const displayName =
      demo.role === "play"
        ? member?.displayName ?? "Human"
        : "Spectator";
    return {
      ...shared,
      draft: draftStateFor(shared, slot),
      members,
      me: {
        id:
          demo.role === "play"
            ? `demo:${draftId}:${slot}`
            : `demo:${draftId}:spectator`,
        displayName,
        role: "member" as const,
        draftSlot: slot,
        teamName: demo.role === "play" ? displayName : "Watching",
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
