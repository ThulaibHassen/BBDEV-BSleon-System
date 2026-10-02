ALTER TABLE "documents" DROP CONSTRAINT "documents_part_ck";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "part" SET DATA TYPE text;--> statement-breakpoint
-- existing numeric parts read as Roman numerals, as on the papers themselves
UPDATE "documents" SET "part" = CASE "part" WHEN '1' THEN 'I' WHEN '2' THEN 'II' ELSE "part" END;