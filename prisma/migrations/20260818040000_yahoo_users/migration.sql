-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "yahooGuid" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "draftSlot" INTEGER,
    "teamName" TEXT,
    "pinsJson" TEXT NOT NULL DEFAULT '[]',
    "avoidsJson" TEXT NOT NULL DEFAULT '[]',
    "weightsJson" TEXT,
    "darkMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueDraft" (
    "id" TEXT NOT NULL DEFAULT 'full-contact-2026',
    "leagueKey" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "teamCount" INTEGER NOT NULL DEFAULT 12,
    "rounds" INTEGER NOT NULL DEFAULT 15,
    "picksJson" TEXT NOT NULL DEFAULT '[]',
    "playersJson" TEXT NOT NULL DEFAULT '[]',
    "importedAt" TEXT NOT NULL DEFAULT 'Synthetic fixture',
    "source" TEXT NOT NULL DEFAULT 'Built-in mock data',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_yahooGuid_key" ON "User"("yahooGuid");
