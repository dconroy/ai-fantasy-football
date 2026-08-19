import { cookies } from "next/headers";

export const DEMO_COOKIE_NAME = "dojo_demo";

export interface DemoClaims {
  readonly roomId: string;
  readonly slot: number | null;
  readonly role: "watch" | "play";
  readonly exp: number;
}

const encoder = new TextEncoder();

function secret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.APP_ACCESS_PASSWORD;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return key;
}

async function hmac(value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`demo:${secret()}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createDemoToken(
  claims: Omit<DemoClaims, "exp">,
  ttlSeconds = 60 * 60 * 8,
) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${claims.roomId}.${claims.slot ?? 0}.${claims.role}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function readDemoToken(token?: string): Promise<DemoClaims | null> {
  if (!token) return Promise.resolve(null);
  const [roomId, slotRaw, role, expRaw, signature] = token.split(".");
  if (!roomId || !slotRaw || !role || !expRaw || !signature) return Promise.resolve(null);
  if (role !== "watch" && role !== "play") return Promise.resolve(null);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return Promise.resolve(null);
  const payload = `${roomId}.${slotRaw}.${role}.${expRaw}`;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return Promise.resolve(null);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return Promise.resolve(null);
  const slot = Number(slotRaw);
  return {
    roomId,
    slot: slot >= 1 && slot <= 14 ? slot : null,
    role,
    exp,
  };
}

export function demoCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export async function getDemoClaims() {
  return cookies().then((jar) => readDemoToken(jar.get(DEMO_COOKIE_NAME)?.value));
}
