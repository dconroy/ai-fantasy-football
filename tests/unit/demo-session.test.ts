import { afterEach, describe, expect, it } from "vitest";
import { createDemoToken, readDemoToken } from "@/auth/demo-session";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("demo session tokens", () => {
  it("round-trips a seat-bound play session", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: 7,
      role: "play",
      sessionId: "lease-456",
    });

    await expect(readDemoToken(token)).resolves.toMatchObject({
      roomId: "demo:room-123",
      slot: 7,
      role: "play",
      sessionId: "lease-456",
    });
  });

  it("round-trips a spectator without assigning a seat", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: null,
      role: "watch",
      sessionId: null,
    });

    await expect(readDemoToken(token)).resolves.toMatchObject({
      slot: null,
      role: "watch",
      sessionId: null,
    });
  });

  it("rejects seat and lease tampering", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: 3,
      role: "play",
      sessionId: "lease-456",
    });

    await expect(readDemoToken(token.replace(".3.play.", ".4.play."))).resolves.toBeNull();
    await expect(readDemoToken(token.replace("lease-456", "lease-999"))).resolves.toBeNull();
  });
});
