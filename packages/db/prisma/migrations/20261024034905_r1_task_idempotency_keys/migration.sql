-- R1 (Rasel, Oct 24; Octavia's Tasks review, retries): the key a screen sends with a save that
-- makes a task or a series, so a retry after a lost answer returns the first record instead of
-- making a second one. idempotency_key is the screen's uuid, unique per firm (NULLs, every
-- existing row, never clash). idempotency_scope says where the key was used, so a key is only
-- replayed on its own route and target: on tasks 'create' (Create Task), 'draft' (Save as Draft)
-- or 'duplicate:<source task id>'; on task_series 'series' (Set Up Recurring Task) or
-- 'convert:<task id>' (Convert to Recurring). A key comes with its scope and a scope with its key.
-- The API gives the record back only to the member who made it (created_by_user_id) on the same
-- scope, and answers any other use of the key 409. A key is kept as long as its row (a discarded
-- draft frees it). No backfill: existing rows keep both NULL. tasks and task_series keep their
-- policies and grants (table-wide, so they cover the new columns).
-- Safe on dev: no lock_timeout, because Prisma would record a timed-out migration as failed and
-- stop every later deploy (P3009) until someone resolves it by hand; the API's transactions end
-- within 30 s, so the locks here wait at most that long. The whole file is one transaction, so
-- both tables stay locked (reads too) until it commits: the ADD COLUMNs only change the catalog
-- (no default, no rewrite), and each CHECK and unique index reads its table once, whatever the
-- RLS policy. Every existing row has both columns NULL, so the CHECKs pass and no key clashes.

-- AlterTable
ALTER TABLE "task_series" ADD COLUMN     "idempotency_key" UUID,
ADD COLUMN     "idempotency_scope" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "idempotency_key" UUID,
ADD COLUMN     "idempotency_scope" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "task_series_business_id_idempotency_key_key" ON "task_series"("business_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_business_id_idempotency_key_key" ON "tasks"("business_id", "idempotency_key");

-- ---------- A key comes with its scope ----------
-- Both or neither.
ALTER TABLE tasks ADD CONSTRAINT tasks_idempotency_pair
  CHECK ((idempotency_key IS NULL) = (idempotency_scope IS NULL));
ALTER TABLE task_series ADD CONSTRAINT task_series_idempotency_pair
  CHECK ((idempotency_key IS NULL) = (idempotency_scope IS NULL));

-- ---------- The scopes ----------
-- The route, and for Duplicate and Convert the task in the URL, as the API stores ids (lower
-- case). Each table takes only its own routes. A NULL scope passes here; the pair check above
-- allows it only without a key.
ALTER TABLE tasks ADD CONSTRAINT tasks_idempotency_scope
  CHECK (idempotency_scope ~ '^(create|draft|duplicate:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
ALTER TABLE task_series ADD CONSTRAINT task_series_idempotency_scope
  CHECK (idempotency_scope ~ '^(series|convert:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
