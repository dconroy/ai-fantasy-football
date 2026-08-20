CREATE TABLE "DemoChatMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorSlot" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "gifUrl" TEXT,
    "gifAlt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemoChatMessage_roomId_createdAt_idx"
    ON "DemoChatMessage"("roomId", "createdAt");

CREATE INDEX "DemoChatMessage_expiresAt_idx"
    ON "DemoChatMessage"("expiresAt");
