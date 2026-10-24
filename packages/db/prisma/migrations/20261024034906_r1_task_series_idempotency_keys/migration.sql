-- R1 (Rasel, Oct 24; Octavia's Tasks review, retries), second of two: the key a screen sends with a
-- save that makes a task series, as r1_task_idempotency_keys does for tasks, so a retry after a
-- lost answer returns the first series instead of making a second one (and its occurrences
-- twice). idempotency_key is the screen's uuid, unique per firm (NULLs, every existing row, never
-- clash). idempotency_scope says where the key was used: 'series' (Set Up Recurring Task) or
-- 'convert:<task id>' (Convert to Recurring). A key comes with its scope and a scope with its key.
-- The API gives the series back only to the member who made it (created_by_user_id) on the same
-- scope, and answers any other use of the key, on a task or a series, 409. A key is kept as long
-- as its row. No backfill: existing rows keep both NULL. task_series keeps its policies and grants
-- (table-wide, so they cover the new columns).
-- Safe on dev: no lock_timeout, because Prisma would record a timed-out migration as failed and
-- stop every later deploy (P3009) until someone resolves it by hand; the API's transactions end
-- within 30 s, so the locks here wait at most that long. A migration of its own, so a transaction
-- of its own that locks task_series only: it never holds one table while waiting for another (the
-- API takes tasks and task_series in both orders, so a migration that locked both could deadlock
-- with it). task_series stays locked (reads too) until this file commits: the ADD COLUMNs only
-- change the catalog (no default, no rewrite), and each CHECK and the unique index read the table
-- once, whatever the RLS policy. Every existing row has both columns NULL, so the CHECKs pass and
-- no key clashes.

-- AlterTable
ALTER TABLE "task_series" ADD COLUMN     "idempotency_key" UUID,
ADD COLUMN     "idempotency_scope" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "task_series_business_id_idempotency_key_key" ON "task_series"("business_id", "idempotency_key");

-- ---------- A key comes with its scope ----------
-- Both or neither.
ALTER TABLE task_series ADD CONSTRAINT task_series_idempotency_pair
  CHECK ((idempotency_key IS NULL) = (idempotency_scope IS NULL));

-- ---------- The scopes ----------
-- The route, and for Convert the task in the URL, as the API stores ids (lower case). Only the
-- series routes: a task's scopes are tasks' (the previous migration). A NULL scope passes here;
-- the pair check above allows it only without a key.
ALTER TABLE task_series ADD CONSTRAINT task_series_idempotency_scope
  CHECK (idempotency_scope ~ '^(series|convert:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
