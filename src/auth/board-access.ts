import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { AuthError, getCurrentUser, requireActiveUser } from "@/auth/current-user";
import { DEMO_COOKIE_NAME, readDemoToken, type DemoClaims } from "@/auth/demo-session";
import { LEAGUE_DRAFT_ID } from "@/persistence/league-draft";

export function boardIdForUser(user: Pick<User, "boardId" | "sleeperDraftId">): string {
  if (user.sleeperDraftId) return `sleeper:${user.sleeperDraftId}`;
  if (user.boardId) return user.boardId;
  return LEAGUE_DRAFT_ID;
}

export function draftIdFromRequest(request: Request, user?: Pick<User, "boardId" | "sleeperDraftId"> | null): string {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("draftId")?.trim();
  if (explicit) return explicit;
  if (user) return boardIdForUser(user);
  return LEAGUE_DRAFT_ID;
}

export function isDemoDraft(draftId: string) {
  return draftId.startsWith("demo:");
}

export async function requireBoardAccess(
  request: Request,
): Promise<{ draftId: string; user: User | null; demo: DemoClaims | null }> {
  const previewId = draftIdFromRequest(request);
  if (isDemoDraft(previewId)) {
    const draftId = previewId;
    const jar = await cookies();
    const demo = await readDemoToken(jar.get(DEMO_COOKIE_NAME)?.value);
    if (!demo || demo.roomId !== draftId) {
      throw new AuthError("Join the demo room first", 401);
    }
    return { draftId, user: null, demo };
  }
  const user = await requireActiveUser();
  const draftId = draftIdFromRequest(request, user);
  return { draftId, user, demo: null };
}

export async function optionalBoardAccess(request: Request): Promise<{
  draftId: string;
  user: User | null;
  demo: DemoClaims | null;
}> {
  const draftId = draftIdFromRequest(request);
  if (isDemoDraft(draftId)) {
    const jar = await cookies();
    const demo = await readDemoToken(jar.get(DEMO_COOKIE_NAME)?.value);
    return { draftId, user: null, demo };
  }
  return { draftId, user: await getCurrentUser(), demo: null };
}
