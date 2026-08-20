import { prisma } from "@/persistence/prisma";

const MESSAGE_TTL_MS = 60 * 60 * 1000;
const POST_COOLDOWN_MS = 1200;
const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 280;

export type DemoChatKind = "text" | "gif";

export interface DemoChatMessagePayload {
  id: string;
  roomId: string;
  authorName: string;
  authorSlot: number;
  kind: DemoChatKind;
  content: string;
  gifUrl: string | null;
  gifAlt: string | null;
  createdAt: string;
  expiresAt: string;
}

export class DemoChatRateLimitError extends Error {}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maximum);
}

export function validateDemoChatText(value: unknown): string {
  const text = cleanText(value, MAX_TEXT_LENGTH);
  if (!text) throw new Error("Write a message first");
  return text;
}

export function validateGiphyUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Choose a GIPHY GIF first");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That GIF URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "giphy.com" && !host.endsWith(".giphy.com"))
  ) {
    throw new Error("Only GIPHY-hosted GIFs are accepted");
  }
  return url.toString();
}

function toPayload(message: {
  id: string;
  roomId: string;
  authorName: string;
  authorSlot: number;
  kind: string;
  content: string;
  gifUrl: string | null;
  gifAlt: string | null;
  createdAt: Date;
  expiresAt: Date;
}): DemoChatMessagePayload {
  return {
    ...message,
    kind: message.kind === "gif" ? "gif" : "text",
    createdAt: message.createdAt.toISOString(),
    expiresAt: message.expiresAt.toISOString(),
  };
}

export async function listDemoChatMessages(
  roomId: string,
  after?: string | null,
): Promise<DemoChatMessagePayload[]> {
  const now = new Date();
  const afterDate = after ? new Date(after) : null;
  const validAfter =
    afterDate && Number.isFinite(afterDate.getTime()) ? afterDate : null;
  const messages = await prisma.demoChatMessage.findMany({
    where: {
      roomId,
      expiresAt: { gt: now },
      ...(validAfter ? { createdAt: { gt: validAfter } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_MESSAGES,
  });
  return messages.map(toPayload);
}

export async function createDemoChatMessage(input: {
  roomId: string;
  authorName: string;
  authorSlot: number;
  kind: DemoChatKind;
  content?: unknown;
  gifUrl?: unknown;
  gifAlt?: unknown;
}): Promise<DemoChatMessagePayload> {
  const now = new Date();
  const recent = await prisma.demoChatMessage.findFirst({
    where: {
      roomId: input.roomId,
      authorSlot: input.authorSlot,
      createdAt: { gt: new Date(now.getTime() - POST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) {
    throw new DemoChatRateLimitError("Slow down for a second");
  }

  const kind: DemoChatKind = input.kind === "gif" ? "gif" : "text";
  const content =
    kind === "text" ? validateDemoChatText(input.content) : cleanText(input.content, 80);
  const gifUrl = kind === "gif" ? validateGiphyUrl(input.gifUrl) : null;
  const gifAlt = kind === "gif" ? cleanText(input.gifAlt, 120) || "GIPHY GIF" : null;
  const message = await prisma.$transaction(async (tx) => {
    await tx.demoChatMessage.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return tx.demoChatMessage.create({
      data: {
        roomId: input.roomId,
        authorName: cleanText(input.authorName, 32) || `Slot ${input.authorSlot}`,
        authorSlot: input.authorSlot,
        kind,
        content,
        gifUrl,
        gifAlt,
        expiresAt: new Date(now.getTime() + MESSAGE_TTL_MS),
      },
    });
  });
  return toPayload(message);
}

export async function deleteDemoChatForRoom(roomId: string): Promise<void> {
  await prisma.demoChatMessage.deleteMany({ where: { roomId } });
}
