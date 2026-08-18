import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken } from "@/auth/session";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("session tokens", () => {
  it("round-trips a signed user cookie", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-session-secret";
    const token = await createSessionToken({
      userId: "user_123",
      status: "active",
      role: "admin",
    });
    await expect(readSessionToken(token)).resolves.toMatchObject({
      userId: "user_123",
      status: "active",
      role: "admin",
    });
  });

  it("rejects pending vs active tampering", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-session-secret";
    const token = await createSessionToken({
      userId: "user_123",
      status: "pending",
      role: "member",
    });
    const tampered = token.replace("pending", "active");
    await expect(readSessionToken(tampered)).resolves.toBeNull();
  });
});
