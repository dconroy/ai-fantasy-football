ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "boardId" TEXT;
UPDATE "User" SET status = 'active' WHERE status = 'pending';
