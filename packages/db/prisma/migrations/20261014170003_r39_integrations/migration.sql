-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'SYNCING', 'NEEDS_ATTENTION', 'PAUSED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "IntegrationEnvironment" AS ENUM ('LIVE', 'TEST');

-- CreateEnum
CREATE TYPE "IntegrationSyncDirection" AS ENUM ('IMPORT', 'EXPORT', 'TWO_WAY');

-- CreateEnum
CREATE TYPE "IntegrationSyncMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'LIVE',
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "status_reason" TEXT,
    "account_label" TEXT,
    "account_id_last4" TEXT,
    "secret_ref" TEXT,
    "secret_rotated_at" TIMESTAMPTZ(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "entities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "direction" "IntegrationSyncDirection" NOT NULL DEFAULT 'TWO_WAY',
    "sync_mode" "IntegrationSyncMode" NOT NULL DEFAULT 'AUTO',
    "sync_every_minutes" INTEGER,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected_by_user_id" UUID,
    "disconnected_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "next_sync_at" TIMESTAMPTZ(3),
    "last_check_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_field_mappings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "local_field" TEXT NOT NULL,
    "external_field" TEXT NOT NULL,
    "direction" "IntegrationSyncDirection" NOT NULL DEFAULT 'TWO_WAY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "requested_by_user_id" UUID,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_business_id_status_idx" ON "integration_connections"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_business_id_id_key" ON "integration_connections"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_business_id_provider_environment_key" ON "integration_connections"("business_id", "provider", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "integration_field_mappings_business_id_connection_id_scope__key" ON "integration_field_mappings"("business_id", "connection_id", "scope", "local_field");

-- CreateIndex
CREATE INDEX "integration_sync_runs_business_id_connection_id_created_at_idx" ON "integration_sync_runs"("business_id", "connection_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_business_id_status_idx" ON "integration_sync_runs"("business_id", "status");

-- AddForeignKey
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "integration_connections"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "integration_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Grants: connections are disconnected, never deleted; a finished sync run is kept.
GRANT SELECT, INSERT, UPDATE ON integration_connections, integration_sync_runs TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_field_mappings TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_connections', 'integration_field_mappings', 'integration_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
-- Short lower-case codes, none twice (provider objects, scopes).
CREATE FUNCTION integration_codes_ok(items text[], max_items integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(items) <= max_items AND array_position(items, NULL) IS NULL
               AND (SELECT count(*) = count(DISTINCT i) AND coalesce(bool_and(i ~ '^[a-z][a-z0-9_]{0,39}$'), true)
                      FROM unnest(items) AS u(i)) $$;

ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_values
  CHECK (provider ~ '^[a-z][a-z0-9_]{1,39}$'
         AND (status_reason IS NULL OR status_reason ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (status <> 'NEEDS_ATTENTION' OR status_reason IS NOT NULL)
         AND (status = 'DISCONNECTED') = (disconnected_at IS NOT NULL)
         AND (account_label IS NULL OR esign_text_ok(account_label, 200))
         AND (account_id_last4 IS NULL OR char_length(account_id_last4) BETWEEN 1 AND 4)
         -- Where the secret is kept: a name or ARN, never a token or key itself.
         AND (secret_ref IS NULL OR (secret_ref ~ '^[A-Za-z0-9/_+=.@:-]{1,255}$'
                                     AND secret_ref !~* '^(sk|pk|rk|whsec|xox[a-z]|gh[ps]|eyJ)'))
         AND jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 20000
         -- Settings are never a place for secrets.
         AND settings::text !~* '"[^"]*(secret|token|password|passwd|api_?key|private_?key|credential)[^"]*"\s*:'
         AND integration_codes_ok(entities, 30)
         AND (sync_every_minutes IS NULL OR sync_every_minutes BETWEEN 5 AND 10080));

ALTER TABLE integration_field_mappings ADD CONSTRAINT integration_field_mappings_values
  CHECK (scope ~ '^[a-z][a-z0-9_]{0,39}$' AND esign_text_ok(local_field, 100)
         AND esign_text_ok(external_field, 100));

ALTER TABLE integration_sync_runs ADD CONSTRAINT integration_sync_runs_values
  CHECK (entity ~ '^[a-z][a-z0-9_]{0,39}$' AND record_count >= 0 AND failed_count >= 0
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (error_message IS NULL OR esign_text_ok(error_message, 500))
         AND (status IN ('QUEUED', 'RUNNING')) = (finished_at IS NULL)
         AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at));

-- A finished sync run is a record: it never changes.
CREATE FUNCTION integration_sync_runs_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status IN ('SUCCEEDED', 'FAILED', 'PARTIAL') THEN
    RAISE EXCEPTION 'SYNC_RUN_FINISHED: a finished sync run does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER integration_sync_runs_frozen BEFORE UPDATE ON integration_sync_runs
  FOR EACH ROW EXECUTE FUNCTION integration_sync_runs_frozen();
