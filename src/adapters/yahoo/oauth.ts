import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/persistence/prisma";
import type { User } from "@prisma/client";

const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const LEGACY_CREDENTIAL_ID = "yahoo-primary";
const MAX_USERS = 8;

interface YahooTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  xoauth_yahoo_guid?: string;
}

export interface YahooLoginResult {
  user: User;
  accessToken: string;
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

export function yahooGuidFromTokens(tokens: YahooTokenResponse): string | null {
  if (tokens.xoauth_yahoo_guid) return tokens.xoauth_yahoo_guid;
  const parts = tokens.access_token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: string;
      guid?: string;
      xoauth_yahoo_guid?: string;
    };
    return payload.xoauth_yahoo_guid ?? payload.guid ?? payload.sub ?? null;
  } catch {
    return null;
  }
}

function displayNameFromTokens(tokens: YahooTokenResponse, guid: string) {
  const parts = tokens.access_token.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
        name?: string;
        nickname?: string;
      };
      if (payload.name?.trim()) return payload.name.trim();
      if (payload.nickname?.trim()) return payload.nickname.trim();
    } catch {
      // Fall through to GUID label.
    }
  }
  return `Yahoo ${guid.slice(-6)}`;
}

async function persistUserTokens(
  user: User,
  tokens: YahooTokenResponse,
  existingRefresh?: string,
): Promise<User> {
  const refreshToken = tokens.refresh_token ?? existingRefresh;
  if (!refreshToken) throw new Error("Yahoo did not return a refresh token");
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000);
  return prisma.user.update({
    where: { id: user.id },
    data: {
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt,
      scope: tokens.scope,
    },
  });
}

export async function exchangeYahooCode(code: string): Promise<YahooLoginResult> {
  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code }),
  );
  const guid = yahooGuidFromTokens(tokens);
  if (!guid) throw new Error("Yahoo did not return a user id");
  if (!tokens.refresh_token) throw new Error("Yahoo did not return a refresh token");

  const existing = await prisma.user.findUnique({ where: { yahooGuid: guid } });
  const userCount = await prisma.user.count();
  if (!existing && userCount >= MAX_USERS) {
    throw new Error("This draft room is full");
  }

  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000);
  const isFirst = !existing && userCount === 0;
  const user = existing
    ? await persistUserTokens(existing, tokens, existing.encryptedRefreshToken ? decrypt(existing.encryptedRefreshToken) : undefined)
    : await prisma.user.create({
        data: {
          yahooGuid: guid,
          displayName: displayNameFromTokens(tokens, guid),
          role: isFirst ? "admin" : "member",
          status: isFirst ? "active" : "pending",
          encryptedAccessToken: encrypt(tokens.access_token),
          encryptedRefreshToken: encrypt(tokens.refresh_token),
          expiresAt,
          scope: tokens.scope,
          draftSlot: isFirst ? 5 : null,
          teamName: isFirst ? "Cobra Kai" : null,
        },
      });

  return { user, accessToken: tokens.access_token };
}

export async function getYahooConnectionStatus(user?: User | null) {
  const credential = user
    ? user
    : await prisma.user.findFirst({
        where: { status: "active" },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      });
  if (credential) {
    return {
      connected: true,
      expiresAt: credential.expiresAt.toISOString(),
      scope: credential.scope,
      updatedAt: credential.updatedAt.toISOString(),
    };
  }
  const legacy = await prisma.oAuthCredential.findUnique({
    where: { id: LEGACY_CREDENTIAL_ID },
    select: { expiresAt: true, scope: true, updatedAt: true },
  });
  return legacy
    ? {
        connected: true,
        expiresAt: legacy.expiresAt.toISOString(),
        scope: legacy.scope,
        updatedAt: legacy.updatedAt.toISOString(),
      }
    : { connected: false };
}

async function refreshUserToken(user: User) {
  if (user.expiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decrypt(user.encryptedAccessToken);
  }
  const refreshToken = decrypt(user.encryptedRefreshToken);
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  await persistUserTokens(user, tokens, refreshToken);
  return tokens.access_token;
}

export async function getValidYahooAccessToken(preferredUser?: User | null) {
  if (preferredUser) return refreshUserToken(preferredUser);

  const admin = await prisma.user.findFirst({
    where: { status: "active", role: "admin" },
    orderBy: { createdAt: "asc" },
  });
  if (admin) return refreshUserToken(admin);

  const member = await prisma.user.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (member) return refreshUserToken(member);

  const legacy = await prisma.oAuthCredential.findUnique({
    where: { id: LEGACY_CREDENTIAL_ID },
  });
  if (!legacy) throw new Error("Yahoo is not connected");
  if (legacy.expiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decrypt(legacy.encryptedAccessToken);
  }
  const refreshToken = decrypt(legacy.encryptedRefreshToken);
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  const nextRefresh = tokens.refresh_token ?? refreshToken;
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1_000);
  await prisma.oAuthCredential.update({
    where: { id: LEGACY_CREDENTIAL_ID },
    data: {
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(nextRefresh),
      expiresAt,
      scope: tokens.scope,
    },
  });
  return tokens.access_token;
}
