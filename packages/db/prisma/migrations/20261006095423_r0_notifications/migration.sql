-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACCOUNT', 'DOCUMENTS', 'INTAKE', 'SERVICES', 'MESSAGES', 'APPOINTMENTS', 'BILLING');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_business_id_recipient_user_id_created_at_idx" ON "notifications"("business_id", "recipient_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_business_id_id_key" ON "notifications"("business_id", "id");

-- CreateIndex
CREATE INDEX "notification_deliveries_business_id_status_created_at_idx" ON "notification_deliveries"("business_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_business_id_notification_id_channel_key" ON "notification_deliveries"("business_id", "notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_business_id_user_id_category_key" ON "notification_preferences"("business_id", "user_id", "category");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_business_id_notification_id_fkey" FOREIGN KEY ("business_id", "notification_id") REFERENCES "notifications"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 7: row-level security and data rules ====================
-- Notifications (bell and Notification Center), their email and SMS deliveries (outbox for
-- the sender, R6), and per-person preferences.

-- ---------- Grants ----------
-- Notifications and deliveries are a record of what was sent: never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON notifications, notification_deliveries TO firmivra_app;
-- Deleting a preference row returns that category to the defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries  FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
-- Within the firm, the API shows each person only their own notifications and preferences.
CREATE POLICY notifications_business ON notifications
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY notification_deliveries_business ON notification_deliveries
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY notification_preferences_business ON notification_preferences
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE notifications ADD CONSTRAINT notifications_type_key
  CHECK (type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$');
ALTER TABLE notifications ADD CONSTRAINT notifications_entity_type_key
  CHECK (entity_type ~ '^[a-z][a-z_]*$');
-- Small, flat payloads: values for the text, not copies of records.
ALTER TABLE notifications ADD CONSTRAINT notifications_payload_small_object
  CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 2048);

ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_attempts
  CHECK (attempts >= 0);
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_sent_at
  CHECK ((status = 'SENT') = (sent_at IS NOT NULL));
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_last_error_short
  CHECK (length(last_error) <= 200);

-- Security notices always go out: there is no preference for ACCOUNT.
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_not_account
  CHECK (category <> 'ACCOUNT');

-- ---------- Who can receive notifications and hold preferences ----------
-- A staff member (any membership) or a client portal login of this firm. Runs under the
-- caller's RLS, so it only ever sees the current firm's people.
CREATE FUNCTION app_is_firm_user(firm uuid, person uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = firm AND m.user_id = person)
            OR EXISTS (SELECT 1 FROM client_accounts c WHERE c.business_id = firm AND c.user_id = person) $$;

-- A notification goes to someone in the firm; afterwards only read_at changes (read or unread).
CREATE FUNCTION notifications_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT app_is_firm_user(NEW.business_id, NEW.recipient_user_id) THEN
      RAISE EXCEPTION 'notifications: the recipient must be a member or client of the firm'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.recipient_user_id <> OLD.recipient_user_id OR NEW.category <> OLD.category
     OR NEW.type <> OLD.type OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id
     OR NEW.payload <> OLD.payload OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'notifications: only read_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER notifications_rules
  BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_rules();

-- A delivery starts QUEUED (or SKIPPED when it will not be sent). SENT and SKIPPED are final;
-- attempts only go up; the notification and channel never change.
CREATE FUNCTION notification_deliveries_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('QUEUED', 'SKIPPED') OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'notification deliveries: a delivery starts QUEUED or SKIPPED, with no attempts'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.notification_id <> OLD.notification_id OR NEW.channel <> OLD.channel
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'notification deliveries: the notification and channel cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SENT', 'SKIPPED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'notification deliveries: a sent or skipped delivery is final'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'notification deliveries: attempts only go up'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER notification_deliveries_rules
  BEFORE INSERT OR UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION notification_deliveries_rules();

-- Preferences belong to someone in the firm; whose and which category never change.
CREATE FUNCTION notification_preferences_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT app_is_firm_user(NEW.business_id, NEW.user_id) THEN
      RAISE EXCEPTION 'notification preferences: the person must be a member or client of the firm'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.business_id <> OLD.business_id OR NEW.user_id <> OLD.user_id
        OR NEW.category <> OLD.category THEN
    RAISE EXCEPTION 'notification preferences: whose and which category cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER notification_preferences_rules
  BEFORE INSERT OR UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION notification_preferences_rules();
