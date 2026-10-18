-- r0_platform_audit_security (R0, Oct 17, Super Admin schema stage B4): Audit & Security (spec 11).
-- One trail (Rasel, Oct 17): audit_logs gains the normalized event fields (category, severity,
-- outcome, actor snapshot, session, target, subject, parent event, risk and rule), all optional, so
-- every existing writer keeps working. The Super Admin team now reads every audit row across firms
-- (the cross-firm dashboard); inserts stay as they were. New platform tables: security alerts,
-- investigation notes and the one-row security policy. Contract note:
-- docs/work/R0-stage-b4-audit.md.

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTHENTICATION', 'AUTHORIZATION', 'DATA', 'INTEGRATION', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'CLIENT', 'PLATFORM', 'SERVICE', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "SecurityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_name" TEXT,
ADD COLUMN     "actor_role" TEXT,
ADD COLUMN     "actor_type" "AuditActorType",
ADD COLUMN     "auth_method" TEXT,
ADD COLUMN     "category" "AuditCategory",
ADD COLUMN     "detection_source" TEXT,
ADD COLUMN     "item_count" INTEGER,
ADD COLUMN     "outcome" "AuditOutcome",
ADD COLUMN     "parent_event_id" UUID,
ADD COLUMN     "risk_score" SMALLINT,
ADD COLUMN     "rule_id" TEXT,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "severity" "AuditSeverity",
ADD COLUMN     "subject_business_id" UUID,
ADD COLUMN     "subject_user_id" UUID,
ADD COLUMN     "target_label" TEXT;

-- CreateTable
CREATE TABLE "security_alerts" (
    "id" UUID NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "business_id" UUID,
    "rule_id" TEXT NOT NULL,
    "severity" "AuditSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "risk_score" SMALLINT,
    "event_key" TEXT NOT NULL,
    "status" "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_investigation_notes" (
    "id" UUID NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "supersedes_note_id" UUID,
    "retracted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_investigation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_security_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mfa" JSONB NOT NULL DEFAULT '{}',
    "password" JSONB NOT NULL DEFAULT '{}',
    "session" JSONB NOT NULL DEFAULT '{}',
    "login_protection" JSONB NOT NULL DEFAULT '{}',
    "admin_access" JSONB NOT NULL DEFAULT '{}',
    "api_integrations" JSONB NOT NULL DEFAULT '{}',
    "audit_retention" JSONB NOT NULL DEFAULT '{}',
    "export_controls" JSONB NOT NULL DEFAULT '{}',
    "alert_routing" JSONB NOT NULL DEFAULT '{}',
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_security_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_alerts_event_key_key" ON "security_alerts"("event_key");

-- CreateIndex
CREATE INDEX "security_alerts_status_created_at_idx" ON "security_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "security_alerts_severity_created_at_idx" ON "security_alerts"("severity", "created_at");

-- CreateIndex
CREATE INDEX "security_alerts_audit_log_id_idx" ON "security_alerts"("audit_log_id");

-- CreateIndex
CREATE INDEX "security_alerts_business_id_created_at_idx" ON "security_alerts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "security_alerts_assigned_to_user_id_status_idx" ON "security_alerts"("assigned_to_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "audit_investigation_notes_supersedes_note_id_key" ON "audit_investigation_notes"("supersedes_note_id");

-- CreateIndex
CREATE INDEX "audit_investigation_notes_audit_log_id_created_at_idx" ON "audit_investigation_notes"("audit_log_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_investigation_notes_audit_log_id_id_key" ON "audit_investigation_notes"("audit_log_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_investigation_notes_audit_log_id_supersedes_note_id_key" ON "audit_investigation_notes"("audit_log_id", "supersedes_note_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_category_created_at_idx" ON "audit_logs"("category", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_severity_created_at_idx" ON "audit_logs"("severity", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_subject_business_id_created_at_idx" ON "audit_logs"("subject_business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_session_id_idx" ON "audit_logs"("session_id");

-- CreateIndex
CREATE INDEX "audit_logs_parent_event_id_idx" ON "audit_logs"("parent_event_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "audit_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_investigation_notes" ADD CONSTRAINT "audit_investigation_notes_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_investigation_notes" ADD CONSTRAINT "audit_investigation_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_investigation_notes" ADD CONSTRAINT "audit_investigation_notes_audit_log_id_supersedes_note_id_fkey" FOREIGN KEY ("audit_log_id", "supersedes_note_id") REFERENCES "audit_investigation_notes"("audit_log_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Values ----------
-- A row with a category is a normalized event: it carries its severity, outcome and actor type.
-- A firm's own row may only be about itself (subject_business_id is for platform rows).
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_event_values
  CHECK ((category IS NULL OR (severity IS NOT NULL AND outcome IS NOT NULL AND actor_type IS NOT NULL))
         AND (actor_name IS NULL OR platform_text_ok(actor_name, 200))
         AND (actor_role IS NULL OR platform_text_ok(actor_role, 100))
         AND (session_id IS NULL OR session_id ~ '^[A-Za-z0-9._:-]{1,128}$')
         AND (auth_method IS NULL OR auth_method ~ '^[a-z][a-z0-9_]{0,49}$')
         AND (target_label IS NULL OR platform_text_ok(target_label, 200))
         AND (subject_business_id IS NULL OR business_id IS NULL OR subject_business_id = business_id)
         AND (parent_event_id IS NULL OR parent_event_id <> id)
         AND (risk_score IS NULL OR risk_score BETWEEN 0 AND 100)
         AND (rule_id IS NULL OR rule_id ~ '^[a-z][a-z0-9_.-]{0,99}$')
         AND (detection_source IS NULL OR detection_source ~ '^[a-z][a-z0-9_.-]{0,49}$')
         AND (item_count IS NULL OR item_count >= 0));

-- Open, acknowledged, or closed (resolved or dismissed); each step carries its time, and the
-- closing note comes only with the close.
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_values
  CHECK (rule_id ~ '^[a-z][a-z0-9_.-]{0,99}$' AND platform_text_ok(title, 200)
         AND (summary IS NULL OR platform_text_ok(summary, 2000))
         AND (risk_score IS NULL OR risk_score BETWEEN 0 AND 100)
         AND btrim(event_key) <> '' AND char_length(event_key) <= 200
         AND (resolution_note IS NULL OR platform_text_ok(resolution_note, 2000))
         AND (CASE status
                WHEN 'OPEN' THEN acknowledged_at IS NULL AND closed_at IS NULL
                WHEN 'ACKNOWLEDGED' THEN acknowledged_at IS NOT NULL AND closed_at IS NULL
                ELSE closed_at IS NOT NULL END)
         AND (acknowledged_by_user_id IS NULL OR acknowledged_at IS NOT NULL)
         AND (closed_by_user_id IS NULL OR closed_at IS NOT NULL)
         AND (resolution_note IS NULL OR closed_at IS NOT NULL));

ALTER TABLE audit_investigation_notes ADD CONSTRAINT audit_investigation_notes_values
  CHECK (platform_text_ok(body, 4000) AND (supersedes_note_id IS NULL OR supersedes_note_id <> id));

-- The policy's safety floors. A section's other keys are the API's to check (zod); these are the
-- values a mistake must never reach: MFA for the platform team at least, a sane password length,
-- bounded sessions and lockouts, secrets always masked, audit kept at least a year, high and
-- critical alerts always in-app.
CREATE FUNCTION platform_json_int_ok(obj jsonb, key text, lo integer, hi integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN jsonb_typeof(obj -> key) = 'number'
                    THEN (obj ->> key)::numeric BETWEEN lo AND hi
                         AND (obj ->> key)::numeric = trunc((obj ->> key)::numeric)
                    ELSE false END $$;

CREATE FUNCTION platform_json_keys_ok(obj jsonb, key text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN jsonb_typeof(obj -> key) = 'array'
                    THEN jsonb_array_length(obj -> key) <= 100
                         AND NOT jsonb_path_exists(obj -> key, '$[*] ? (@.type() != "string")')
                    ELSE false END $$;

ALTER TABLE platform_security_policy ADD CONSTRAINT platform_security_policy_values
  CHECK (id = 1 AND version >= 1
         AND jsonb_typeof(mfa) = 'object' AND octet_length(mfa::text) <= 16384
         AND jsonb_typeof(password) = 'object' AND octet_length(password::text) <= 16384
         AND jsonb_typeof(session) = 'object' AND octet_length(session::text) <= 16384
         AND jsonb_typeof(login_protection) = 'object' AND octet_length(login_protection::text) <= 16384
         AND jsonb_typeof(admin_access) = 'object' AND octet_length(admin_access::text) <= 16384
         AND jsonb_typeof(api_integrations) = 'object' AND octet_length(api_integrations::text) <= 16384
         AND jsonb_typeof(audit_retention) = 'object' AND octet_length(audit_retention::text) <= 16384
         AND jsonb_typeof(export_controls) = 'object' AND octet_length(export_controls::text) <= 16384
         AND jsonb_typeof(alert_routing) = 'object' AND octet_length(alert_routing::text) <= 16384
         AND mfa ->> 'requiredFor' IN ('PLATFORM_ADMINS', 'PLATFORM_ADMINS_AND_ROLES', 'ALL_USERS')
         AND platform_json_keys_ok(mfa, 'roleKeys')
         AND platform_json_int_ok(password, 'minLength', 8, 128)
         AND platform_json_int_ok(password, 'preventReuseCount', 0, 24)
         AND platform_json_int_ok(session, 'idleTimeoutMinutes', 5, 1440)
         AND platform_json_int_ok(session, 'maxLifetimeHours', 1, 720)
         AND platform_json_int_ok(login_protection, 'maxFailedAttempts', 3, 20)
         AND platform_json_int_ok(login_protection, 'lockoutMinutes', 1, 1440)
         AND platform_json_int_ok(admin_access, 'reauthWindowMinutes', 1, 60)
         AND (api_integrations -> 'maskSecrets') = 'true'::jsonb
         AND platform_json_int_ok(api_integrations, 'tokenLifetimeDays', 1, 365)
         AND platform_json_int_ok(audit_retention, 'retentionDays', 365, 3650)
         AND platform_json_int_ok(audit_retention, 'archiveAfterDays', 30, 3650)
         AND (audit_retention ->> 'archiveAfterDays')::int <= (audit_retention ->> 'retentionDays')::int
         AND platform_json_int_ok(export_controls, 'linkExpiryHours', 1, 168)
         AND platform_json_keys_ok(export_controls, 'exportRoleKeys')
         AND (alert_routing -> 'inApp') = 'true'::jsonb
         AND alert_routing ->> 'minimumSeverity' IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
         AND platform_json_keys_ok(alert_routing, 'recipientRoleKeys'));

-- ---------- Rules ----------
-- The database stamps an audit row's time when the app writes it (spec 11: created_at is
-- server-generated). The owner (migrations, seeds, the database's own functions) may still write a
-- past time, so demo and test history can be dated.
CREATE FUNCTION audit_logs_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF current_user = 'firmivra_app' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER audit_logs_stamp BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_stamp();

-- An alert's content is fixed at insert. Afterwards only the status moves forward (OPEN ->
-- ACKNOWLEDGED -> RESOLVED or DISMISSED, or OPEN straight to a final state), the assignee changes
-- while it is not closed (or is cleared when that admin is removed), and the closing note comes
-- with the close. The database stamps who acknowledged and who closed it (the signed-in team
-- member; nobody for a platform job), and when.
CREATE FUNCTION security_alerts_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.acknowledged_at IS NOT NULL OR NEW.acknowledged_by_user_id IS NOT NULL
       OR NEW.closed_at IS NOT NULL OR NEW.closed_by_user_id IS NOT NULL OR NEW.resolution_note IS NOT NULL THEN
      RAISE EXCEPTION 'security alerts: a new alert starts OPEN' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.audit_log_id, NEW.business_id, NEW.rule_id, NEW.severity, NEW.title, NEW.summary,
      NEW.risk_score, NEW.event_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.audit_log_id, OLD.business_id, OLD.rule_id, OLD.severity, OLD.title, OLD.summary,
      OLD.risk_score, OLD.event_key, OLD.created_at) THEN
    RAISE EXCEPTION 'security alerts: an alert''s content never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.acknowledged_by_user_id IS DISTINCT FROM OLD.acknowledged_by_user_id
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id THEN
    RAISE EXCEPTION 'security alerts: the database stamps who acknowledged and closed an alert'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('RESOLVED', 'DISMISSED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note
       OR (NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id
           AND NEW.assigned_to_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'security alerts: a % alert never changes', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'OPEN' AND NEW.status IN ('ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'))
            OR (OLD.status = 'ACKNOWLEDGED' AND NEW.status IN ('RESOLVED', 'DISMISSED'))) THEN
      RAISE EXCEPTION 'security alerts: % cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'ACKNOWLEDGED' THEN
      NEW.acknowledged_at := now();
      NEW.acknowledged_by_user_id := app_current_admin_id();
    ELSE
      NEW.closed_at := now();
      NEW.closed_by_user_id := app_current_admin_id();
    END IF;
  ELSIF NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
    RAISE EXCEPTION 'security alerts: the closing note comes with the close'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER security_alerts_rules BEFORE INSERT OR UPDATE ON security_alerts
  FOR EACH ROW EXECUTE FUNCTION security_alerts_rules();

-- A note's text never changes. An edit is a new note by the same author that supersedes a note
-- not yet retracted; a delete retracts the note once (the database stamps it). The RLS policies
-- make the author the signed-in team member.
CREATE FUNCTION audit_investigation_notes_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  earlier record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.retracted_at IS NOT NULL THEN
      RAISE EXCEPTION 'audit notes: a new note is not retracted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.supersedes_note_id IS NOT NULL THEN
      SELECT author_user_id, retracted_at INTO earlier
      FROM audit_investigation_notes WHERE id = NEW.supersedes_note_id;
      IF NOT FOUND OR earlier.author_user_id <> NEW.author_user_id OR earlier.retracted_at IS NOT NULL THEN
        RAISE EXCEPTION 'audit notes: only the author edits a note, and not a retracted one'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.audit_log_id, NEW.author_user_id, NEW.body, NEW.supersedes_note_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.audit_log_id, OLD.author_user_id, OLD.body, OLD.supersedes_note_id, OLD.created_at) THEN
    RAISE EXCEPTION 'audit notes: a note never changes; an edit is a new note'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.retracted_at IS NOT NULL OR NEW.retracted_at IS NULL THEN
    RAISE EXCEPTION 'audit notes: a note is retracted once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.retracted_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER audit_investigation_notes_rules BEFORE INSERT OR UPDATE ON audit_investigation_notes
  FOR EACH ROW EXECUTE FUNCTION audit_investigation_notes_rules();

-- Every save is a new version (the API saves with the version it read, so a concurrent save finds
-- no row and must reload). The database stamps the time and the team member who saved.
CREATE FUNCTION platform_security_policy_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'security policy: there is one policy row' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_security_policy_rules BEFORE UPDATE ON platform_security_policy
  FOR EACH ROW EXECUTE FUNCTION platform_security_policy_rules();

-- ---------- The default policy ----------
-- No forced periodic password rotation (spec 11). Audit kept 7 years, read-only in the UI.
INSERT INTO platform_security_policy (id, version, mfa, password, session, login_protection,
  admin_access, api_integrations, audit_retention, export_controls, alert_routing, updated_at)
VALUES (1, 1,
  '{"requiredFor": "PLATFORM_ADMINS", "roleKeys": [], "methods": ["TOTP"]}',
  '{"minLength": 12, "requireUppercase": true, "requireLowercase": true, "requireNumber": true, "requireSymbol": false, "preventReuseCount": 5, "rotationDays": null}',
  '{"idleTimeoutMinutes": 30, "maxLifetimeHours": 12, "concurrentSessions": "ALLOW", "adminsCanRevokeAll": true}',
  '{"maxFailedAttempts": 5, "lockoutMinutes": 15, "suspiciousLoginAlerts": true, "ipAllowList": [], "ipBlockList": []}',
  '{"reauthForHighRiskChanges": true, "reauthWindowMinutes": 10}',
  '{"maskSecrets": true, "tokenLifetimeDays": 90, "rotationReminderDays": 14, "requireWebhookSignatures": true, "disableAfterAuthFailures": 5}',
  '{"retentionDays": 2555, "archiveAfterDays": 365, "editable": false}',
  '{"exportRoleKeys": [], "requireReauth": true, "linkExpiryHours": 24}',
  '{"inApp": true, "email": true, "sms": false, "webhook": false, "minimumSeverity": "HIGH", "recipientRoleKeys": []}',
  now());

-- ---------- Grants ----------
-- Nothing is deleted: alerts and notes are kept as the record; the policy row is only updated.
GRANT SELECT, INSERT, UPDATE ON security_alerts, audit_investigation_notes TO firmivra_app;
GRANT SELECT, UPDATE ON platform_security_policy TO firmivra_app;

-- ---------- Row-level security ----------
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_investigation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_investigation_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_security_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_security_policy FORCE ROW LEVEL SECURITY;

-- The wall change (for Rasel to confirm in the PR): the Super Admin team (admin scope) reads every
-- audit row, the firms' rows included, for the cross-firm dashboard. It replaces
-- audit_logs_admin_read (platform rows only). Which team member may read, search or export is the
-- API's check (audit.* keys). A firm still reads only its own rows; inserts are unchanged; nobody
-- updates or deletes a row.
DROP POLICY audit_logs_admin_read ON audit_logs;
CREATE POLICY audit_logs_team_read ON audit_logs FOR SELECT
  USING (app_is_admin() OR app_is_platform_member());

-- Alerts: the team reads and works them (admin scope); the rules engine raises and may close them
-- (platform scope). No firm scope reaches them.
CREATE POLICY security_alerts_read ON security_alerts FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY security_alerts_raise ON security_alerts FOR INSERT
  WITH CHECK (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY security_alerts_work ON security_alerts FOR UPDATE
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member())
  WITH CHECK (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());

-- Notes: the team reads them; a team member writes and retracts only their own.
CREATE POLICY audit_investigation_notes_read ON audit_investigation_notes FOR SELECT
  USING (app_is_admin() OR app_is_platform_member());
CREATE POLICY audit_investigation_notes_write ON audit_investigation_notes FOR INSERT
  WITH CHECK (author_user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()));
CREATE POLICY audit_investigation_notes_retract ON audit_investigation_notes FOR UPDATE
  USING (author_user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()))
  WITH CHECK (author_user_id = app_current_admin_id());

-- The policy: the team reads and saves it (which member may save is the API's security.* check);
-- the platform's own services (sign-in, sessions, exports) read it in platform scope.
CREATE POLICY platform_security_policy_read ON platform_security_policy FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_security_policy_save ON platform_security_policy FOR UPDATE
  USING (app_is_admin() OR app_is_platform_member())
  WITH CHECK (app_is_admin() OR app_is_platform_member());
