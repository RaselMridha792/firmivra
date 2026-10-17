-- r0_platform_notifications (R0, Oct 17, Super Admin schema stage B1): the Super Admin's own
-- notification center (Notifications spec) and the export jobs every Super Admin module shares
-- (Audit, Integration logs, Communications, Reports, Billing, Support, Sales exports). Platform
-- data: no firm scope reads either table. Contract note: docs/work/R0-stage-b1-notifications.md.

-- CreateEnum
CREATE TYPE "PlatformNotificationCategory" AS ENUM ('FIRMS', 'FIRM_APPLICATIONS', 'SALES_LEADS', 'BILLING_SUBSCRIPTIONS', 'SUPPORT', 'INTEGRATIONS', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PlatformNotificationPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "PlatformNotificationAttention" AS ENUM ('NONE', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PlatformExportModule" AS ENUM ('AUDIT', 'BILLING', 'COMMUNICATIONS', 'INTEGRATION_LOGS', 'REPORTS', 'SALES', 'SUPPORT');

-- CreateEnum
CREATE TYPE "PlatformExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "platform_notifications" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "category" "PlatformNotificationCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "priority" "PlatformNotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_label" TEXT,
    "business_id" UUID,
    "event_key" TEXT NOT NULL,
    "requires_action" BOOLEAN NOT NULL DEFAULT false,
    "attention" "PlatformNotificationAttention" NOT NULL DEFAULT 'NONE',
    "read_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "dismissed_at" TIMESTAMPTZ(3),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_export_jobs" (
    "id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "module" "PlatformExportModule" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "title" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PlatformExportStatus" NOT NULL DEFAULT 'QUEUED',
    "row_count" INTEGER,
    "s3_key" TEXT,
    "size_bytes" INTEGER,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_notifications_recipient_user_id_occurred_at_idx" ON "platform_notifications"("recipient_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "platform_notifications_recipient_user_id_attention_idx" ON "platform_notifications"("recipient_user_id", "attention");

-- CreateIndex
CREATE INDEX "platform_notifications_source_type_source_id_idx" ON "platform_notifications"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_notifications_recipient_user_id_event_key_key" ON "platform_notifications"("recipient_user_id", "event_key");

-- CreateIndex
CREATE INDEX "platform_export_jobs_requested_by_user_id_created_at_idx" ON "platform_export_jobs"("requested_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_export_jobs_status_created_at_idx" ON "platform_export_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_export_jobs" ADD CONSTRAINT "platform_export_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
-- Informational items never ask for work. An item that asks for work can be resolved or
-- dismissed; any item can be dismissed. Each final state carries its time.
ALTER TABLE platform_notifications ADD CONSTRAINT platform_notifications_values
  CHECK (type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND source_type ~ '^[a-z][a-z_]*$'
         AND platform_text_ok(title, 200) AND (body IS NULL OR platform_text_ok(body, 1000))
         AND (source_label IS NULL OR platform_text_ok(source_label, 200))
         AND btrim(event_key) <> '' AND char_length(event_key) <= 200
         AND (priority <> 'INFORMATIONAL' OR NOT requires_action)
         AND (CASE WHEN requires_action THEN attention IN ('ACTION_REQUIRED', 'RESOLVED', 'DISMISSED')
                   ELSE attention IN ('NONE', 'DISMISSED') END)
         AND (attention = 'RESOLVED') = (resolved_at IS NOT NULL)
         AND (resolved_by_user_id IS NULL OR resolved_at IS NOT NULL)
         AND (attention = 'DISMISSED') = (dismissed_at IS NOT NULL));

ALTER TABLE platform_export_jobs ADD CONSTRAINT platform_export_jobs_values
  CHECK (platform_text_ok(title, 200)
         AND jsonb_typeof(filters) = 'object' AND octet_length(filters::text) <= 8192
         AND cardinality(columns) <= 200 AND array_position(columns, NULL) IS NULL
         AND (row_count IS NULL OR row_count >= 0) AND (size_bytes IS NULL OR size_bytes >= 0)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (s3_key IS NULL OR (starts_with(s3_key, 'platform/exports/' || id || '/')
                                 AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'))
         AND (CASE status
                WHEN 'QUEUED' THEN started_at IS NULL AND finished_at IS NULL AND s3_key IS NULL
                                   AND row_count IS NULL AND error_code IS NULL
                WHEN 'RUNNING' THEN started_at IS NOT NULL AND finished_at IS NULL
                                    AND s3_key IS NULL AND error_code IS NULL
                WHEN 'COMPLETED' THEN started_at IS NOT NULL AND finished_at IS NOT NULL
                                      AND s3_key IS NOT NULL AND row_count IS NOT NULL
                                      AND expires_at IS NOT NULL AND error_code IS NULL
                WHEN 'FAILED' THEN finished_at IS NOT NULL AND error_code IS NOT NULL AND s3_key IS NULL
                ELSE finished_at IS NOT NULL AND s3_key IS NOT NULL AND error_code IS NULL END)
         AND (started_at IS NULL OR started_at >= created_at)
         AND (finished_at IS NULL OR finished_at >= coalesce(started_at, created_at))
         AND (expires_at IS NULL OR expires_at > finished_at));

-- ---------- Rules ----------
-- A notification's content is fixed at insert. Afterwards only the read state (read, or unread
-- again) and the attention state change; resolved and dismissed are final and the database
-- stamps them. business_id may only be cleared, by the firm's own deletion (ON DELETE SET NULL).
CREATE FUNCTION platform_notifications_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attention <> (CASE WHEN NEW.requires_action THEN 'ACTION_REQUIRED' ELSE 'NONE' END)::"PlatformNotificationAttention"
       OR NEW.read_at IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NEW.dismissed_at IS NOT NULL THEN
      RAISE EXCEPTION 'platform notifications: a new item starts unread, open and unresolved'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.occurred_at > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'platform notifications: an item cannot have happened in the future'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.recipient_user_id, NEW.category, NEW.type, NEW.priority, NEW.title, NEW.body,
      NEW.source_type, NEW.source_id, NEW.source_label, NEW.event_key, NEW.requires_action,
      NEW.occurred_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.recipient_user_id, OLD.category, OLD.type, OLD.priority, OLD.title, OLD.body,
      OLD.source_type, OLD.source_id, OLD.source_label, OLD.event_key, OLD.requires_action,
      OLD.occurred_at, OLD.created_at)
     OR (NEW.business_id IS DISTINCT FROM OLD.business_id AND NEW.business_id IS NOT NULL) THEN
    RAISE EXCEPTION 'platform notifications: only the read and attention state change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attention IS DISTINCT FROM OLD.attention THEN
    IF OLD.attention IN ('RESOLVED', 'DISMISSED') THEN
      RAISE EXCEPTION 'platform notifications: a % item stays %', OLD.attention, OLD.attention
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.attention = 'RESOLVED' THEN NEW.resolved_at := now(); END IF;
    IF NEW.attention = 'DISMISSED' THEN NEW.dismissed_at := now(); END IF;
  ELSIF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
        OR NEW.resolved_by_user_id IS DISTINCT FROM OLD.resolved_by_user_id
        OR NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at THEN
    RAISE EXCEPTION 'platform notifications: resolved and dismissed are set with the attention state'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_notifications_rules BEFORE INSERT OR UPDATE ON platform_notifications
  FOR EACH ROW EXECUTE FUNCTION platform_notifications_rules();

-- An export job's request never changes; its status moves forward only:
-- QUEUED -> RUNNING -> COMPLETED -> EXPIRED, and QUEUED or RUNNING -> FAILED.
CREATE FUNCTION platform_export_jobs_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' THEN
      RAISE EXCEPTION 'platform export jobs: a job starts QUEUED' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.requested_by_user_id, NEW.module, NEW.format, NEW.title, NEW.filters,
      NEW.columns, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.requested_by_user_id, OLD.module, OLD.format, OLD.title, OLD.filters,
      OLD.columns, OLD.created_at) THEN
    RAISE EXCEPTION 'platform export jobs: the request never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('FAILED', 'EXPIRED') THEN
    RAISE EXCEPTION 'platform export jobs: a % job never changes', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING', 'FAILED'))
    OR (OLD.status = 'RUNNING' AND NEW.status IN ('COMPLETED', 'FAILED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status = 'EXPIRED')) THEN
    RAISE EXCEPTION 'platform export jobs: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_export_jobs_rules BEFORE INSERT OR UPDATE ON platform_export_jobs
  FOR EACH ROW EXECUTE FUNCTION platform_export_jobs_rules();

-- ---------- Grants ----------
-- Nothing is deleted: notifications and export jobs are kept as history.
GRANT SELECT, INSERT, UPDATE ON platform_notifications, platform_export_jobs TO firmivra_app;

-- ---------- Row-level security ----------
ALTER TABLE platform_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_export_jobs FORCE ROW LEVEL SECURITY;

-- Notifications: each Super Admin team member reads and updates only their own (admin scope).
-- Producers write them, and resolve every copy once the underlying task is done, from the
-- platform scope (events, jobs) or from a signed-in team member's action (admin scope). No firm
-- scope reaches either table.
CREATE POLICY platform_notifications_own_read ON platform_notifications FOR SELECT
  USING (recipient_user_id = app_current_admin_id() OR app_scope() = 'platform');
CREATE POLICY platform_notifications_produce ON platform_notifications FOR INSERT
  WITH CHECK (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_notifications_own_update ON platform_notifications FOR UPDATE
  USING (recipient_user_id = app_current_admin_id() OR app_scope() = 'platform')
  WITH CHECK (recipient_user_id = app_current_admin_id() OR app_scope() = 'platform');

-- Export jobs: a team member asks for their own and reads them; the CEO (app_is_admin) reads all;
-- the export worker reads and moves them in the platform scope. Only the worker updates.
CREATE POLICY platform_export_jobs_read ON platform_export_jobs FOR SELECT
  USING (requested_by_user_id = app_current_admin_id() OR app_is_admin() OR app_scope() = 'platform');
CREATE POLICY platform_export_jobs_request ON platform_export_jobs FOR INSERT
  WITH CHECK (requested_by_user_id = app_current_admin_id()
              AND (app_is_admin() OR app_is_platform_member()));
CREATE POLICY platform_export_jobs_worker ON platform_export_jobs FOR UPDATE
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
