import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/persistence/prisma";

const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const CREDENTIAL_ID = "yahoo-primary";

interface YahooTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encryptionKey() {
  const key = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64");
  }
  return key;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decrypt(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored OAuth token is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createYahooAuthorizationUrl(state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", required("YAHOO_CLIENT_ID"));
  url.searchParams.set("redirect_uri", required("YAHOO_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("language", "en-us");
  const scope = process.env.YAHOO_OAUTH_SCOPE?.trim();
  if (scope) url.searchParams.set("scope", scope);
  return url;
}

async function requestTokens(parameters: URLSearchParams): Promise<YahooTokenResponse> {
  parameters.set("client_id", required("YAHOO_CLIENT_ID"));
  parameters.set("client_secret", required("YAHOO_CLIENT_SECRET"));
  parameters.set("redirect_uri", required("YAHOO_REDIRECT_URI"));
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
    cache: "no-store",
  });
  const body = (await response.json()) as YahooTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `Yahoo token error ${response.status}`);
  }
  return body;
}

async function persistTokens(tokens: YahooTokenResponse, existingRefresh?: string) {
  const refreshToken = tokens.refresh_token ?? existingRefresh;
  if (!refreshToken) throw new Error("Yahoo did not return a refresh token");
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000);
  await prisma.oAuthCredential.upsert({
    where: { id: CREDENTIAL_ID },
    create: {
      id: CREDENTIAL_ID,
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt,
      scope: tokens.scope,
    },
    update: {
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt,
      scope: tokens.scope,
    },
  });
  return tokens.access_token;
}

export async function exchangeYahooCode(code: string) {
  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code }),
  );
  return persistTokens(tokens);
}

export async function getYahooConnectionStatus() {
  const credential = await prisma.oAuthCredential.findUnique({
    where: { id: CREDENTIAL_ID },
    select: { expiresAt: true, scope: true, updatedAt: true },
  });
  return credential
    ? {
        connected: true,
        expiresAt: credential.expiresAt.toISOString(),
        scope: credential.scope,
        updatedAt: credential.updatedAt.toISOString(),
      }
    : { connected: false };
}

export async function getValidYahooAccessToken() {
  const credential = await prisma.oAuthCredential.findUnique({
    where: { id: CREDENTIAL_ID },
  });
  if (!credential) throw new Error("Yahoo is not connected");
  if (credential.expiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decrypt(credential.encryptedAccessToken);
  }
  const refreshToken = decrypt(credential.encryptedRefreshToken);
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  return persistTokens(tokens, refreshToken);
}
