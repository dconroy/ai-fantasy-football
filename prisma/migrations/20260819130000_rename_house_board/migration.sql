-- Rename the legacy house board id off the "full-contact" brand.
-- Only the LeagueDraft row references the literal; house users carry boardId = NULL
-- and resolve through the LEAGUE_DRAFT_ID constant, so they follow automatically.
--
-- If the app already auto-created an empty "house-2026" placeholder (e.g. the new
-- constant shipped before this migration ran), drop it so the legacy row can take
-- its id and keep its data.
DELETE FROM "LeagueDraft"
 WHERE "id" = 'house-2026'
   AND EXISTS (SELECT 1 FROM "LeagueDraft" WHERE "id" = 'full-contact-2026');
UPDATE "LeagueDraft" SET "id" = 'house-2026' WHERE "id" = 'full-contact-2026';
UPDATE "User" SET "boardId" = 'house-2026' WHERE "boardId" = 'full-contact-2026';
ALTER TABLE "LeagueDraft" ALTER COLUMN "id" SET DEFAULT 'house-2026';
