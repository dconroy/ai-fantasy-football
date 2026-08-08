-- CreateTable
CREATE TABLE "DraftSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leagueKey" TEXT,
    "draftSlot" INTEGER NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMapping" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourcePosition" TEXT NOT NULL,
    "yahooPlayerId" TEXT NOT NULL,
    "yahooName" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDate" TIMESTAMP(3),
    "playerCount" INTEGER NOT NULL,
    "checksum" TEXT,
    "payload" TEXT NOT NULL,

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yahoo',
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yahoo',
    "leagueKey" TEXT NOT NULL,
    "leagueName" TEXT,
    "teamKey" TEXT,
    "teamName" TEXT,
    "draftSlot" INTEGER,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMapping_sourceName_sourcePosition_key" ON "PlayerMapping"("sourceName", "sourcePosition");

-- CreateIndex
CREATE INDEX "DataImport_source_fetchedAt_idx" ON "DataImport"("source", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueConnection_leagueKey_key" ON "LeagueConnection"("leagueKey");
