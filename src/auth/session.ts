export const SESSION_COOKIE_NAME = "conroy_ai_user";

export interface SessionClaims {
  readonly userId: string;
  readonly status: "pending" | "active";
  readonly role: "admin" | "member";
  readonly exp: number;
}

const encoder = new TextEncoder();

function sessionSecret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.APP_ACCESS_PASSWORD;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return key;
}

async function hmac(value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(claims: Omit<SessionClaims, "exp">, ttlSeconds = 60 * 60 * 24 * 30) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${claims.userId}.${claims.status}.${claims.role}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function readSessionToken(token?: string): Promise<SessionClaims | null> {
  if (!token) return Promise.resolve(null);
  const [userId, status, role, expRaw, signature] = token.split(".");
  if (!userId || !status || !role || !expRaw || !signature) return Promise.resolve(null);
  if (status !== "pending" && status !== "active") return Promise.resolve(null);
  if (role !== "admin" && role !== "member") return Promise.resolve(null);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return Promise.resolve(null);
  const payload = `${userId}.${status}.${role}.${expRaw}`;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return Promise.resolve(null);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return Promise.resolve(null);
  return { userId, status, role, exp };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
