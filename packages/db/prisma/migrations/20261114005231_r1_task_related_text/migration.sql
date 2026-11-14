-- R1 (Rasel's approval in R1's window, Nov 13; Tasks A1, R56's ask). tasks.related_text: the
-- firm's own words for Related To when no record fits (the same column serves drafts, which are
-- tasks). Labelled custom on screen, never a link. 1 to 200 characters, and a task has an
-- engagement or this text, never both. No backfill; safe on dev (a nullable column).

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "related_text" TEXT;

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE tasks ADD CONSTRAINT tasks_related_text
  CHECK ((related_text IS NULL OR char_length(btrim(related_text)) BETWEEN 1 AND 200)
     AND NOT (engagement_id IS NOT NULL AND related_text IS NOT NULL));
