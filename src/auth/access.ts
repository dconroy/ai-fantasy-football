const COOKIE_NAME = "conroy_ai_access";

export const ACCESS_COOKIE_NAME = COOKIE_NAME;

export async function createAccessToken(password: string) {
  const bytes = new TextEncoder().encode(`conroy-ai-draft-room:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validAccessToken(token?: string) {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return true;
  if (!token) return false;
  return token === (await createAccessToken(password));
}
