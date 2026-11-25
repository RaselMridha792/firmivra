-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_business_id_task_id_created_at_idx" ON "task_comments"("business_id", "task_id", "created_at");

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_business_id_author_user_id_fkey" FOREIGN KEY ("business_id", "author_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE task_comments
  ADD CONSTRAINT task_comments_body_not_blank CHECK (char_length(btrim(body)) > 0);

GRANT SELECT, INSERT, UPDATE, DELETE ON task_comments TO firmivra_app;

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY task_comments_business ON task_comments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
