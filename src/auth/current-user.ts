import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/persistence/prisma";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
} from "./session";

export type AppUser = User;

export async function getSessionClaims() {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE_NAME)?.value);
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const claims = await getSessionClaims();
  if (!claims) return null;
  return prisma.user.findUnique({ where: { id: claims.userId } });
}

export async function requireActiveUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Authentication required", 401);
  if (user.status === "active") return user;
  return prisma.user.update({
    where: { id: user.id },
    data: { status: "active" },
  });
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireActiveUser();
  if (user.role !== "admin") throw new AuthError("Admin only", 403);
  return user;
}

export async function sessionTokenFor(user: Pick<User, "id" | "status" | "role">) {
  return createSessionToken({
    userId: user.id,
    status: user.status === "active" ? "active" : "pending",
    role: user.role === "admin" ? "admin" : "member",
  });
}

export { SESSION_COOKIE_NAME, sessionCookieOptions };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
