import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/persistence/prisma", () => ({
  prisma: {
    demoChatMessage: {
      findFirst: mocks.findFirst,
      findMany: vi.fn(),
      deleteMany: mocks.deleteMany,
    },
    $transaction: vi.fn(async (callback) =>
      callback({
        demoChatMessage: {
          create: mocks.create,
          deleteMany: mocks.deleteMany,
        },
      }),
    ),
  },
}));

import {
  createDemoChatMessage,
  DemoChatRateLimitError,
  validateDemoChatText,
  validateGiphyUrl,
} from "@/persistence/demo-chat";

describe("demo chat", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.create.mockReset();
    mocks.deleteMany.mockReset();
    mocks.findFirst.mockResolvedValue(null);
  });

  it("validates text and GIPHY media URLs", () => {
    expect(validateDemoChatText("  hello room  ")).toBe("hello room");
    expect(() => validateDemoChatText("   ")).toThrow(/message/i);
    expect(
      validateGiphyUrl("https://media2.giphy.com/media/abc/200w.webp"),
    ).toContain("media2.giphy.com");
    expect(() => validateGiphyUrl("https://example.com/not-giphy.gif")).toThrow(
      /GIPHY-hosted/,
    );
  });

  it("creates messages with server-provided identity and a one-hour expiry", async () => {
    mocks.create.mockImplementation(async ({ data }) => ({
      id: "message-1",
      ...data,
      gifUrl: null,
      gifAlt: null,
      createdAt: new Date(),
    }));

    const message = await createDemoChatMessage({
      roomId: "demo:room",
      authorName: "Cobra Kai",
      authorSlot: 4,
      kind: "text",
      content: "On the clock",
    });

    expect(message.authorName).toBe("Cobra Kai");
    expect(message.authorSlot).toBe(4);
    expect(Date.parse(message.expiresAt) - Date.parse(message.createdAt)).toBeGreaterThan(
      59 * 60 * 1000,
    );
  });

  it("rate-limits repeated posts from the same seat", async () => {
    mocks.findFirst.mockResolvedValue({ id: "recent-message" });
    await expect(
      createDemoChatMessage({
        roomId: "demo:room",
        authorName: "Cobra Kai",
        authorSlot: 4,
        kind: "text",
        content: "again",
      }),
    ).rejects.toBeInstanceOf(DemoChatRateLimitError);
  });
});
