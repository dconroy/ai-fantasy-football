import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/prisma", () => ({
  prisma: {
    syncCheckpoint: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/persistence/prisma";
import { validateDemoSeat } from "@/persistence/demo-rooms";

const findUnique = vi.mocked(prisma.syncCheckpoint.findUnique);

describe("demo seat leases", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("accepts only the session bound to an active seat", async () => {
    findUnique.mockResolvedValue({
      id: "demo-seats:demo:room-123",
      sequence: 4,
      payload: JSON.stringify({
        5: { seenAt: new Date().toISOString(), sessionId: "current-session" },
      }),
      syncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      validateDemoSeat("demo:room-123", 5, "current-session"),
    ).resolves.toBe(true);
    await expect(
      validateDemoSeat("demo:room-123", 5, "replaced-session"),
    ).resolves.toBe(false);
  });

  it("rejects expired and legacy unbound seat claims", async () => {
    findUnique.mockResolvedValue({
      id: "demo-seats:demo:room-123",
      sequence: 1,
      payload: JSON.stringify({
        3: { seenAt: new Date(Date.now() - 61_000).toISOString(), sessionId: "expired" },
        4: new Date().toISOString(),
      }),
      syncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      validateDemoSeat("demo:room-123", 3, "expired"),
    ).resolves.toBe(false);
    await expect(
      validateDemoSeat("demo:room-123", 4, "legacy-cookie"),
    ).resolves.toBe(false);
  });
});
