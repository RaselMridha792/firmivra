-- r0_platform_integrations (R0, Oct 18, Super Admin schema stage B8): Integrations (spec 14).
-- Firmivra's own service connections (credentials by reference only) with their sync and test
-- runs, the central redacted integration log, the catalog firms see (status, plan access and firm
-- allow or deny; the provider key matches integration_connections.provider, and provider
-- definitions stay in code), Firmivra-issued API keys (hash only), webhook endpoints and
-- deliveries, and the daily usage and adoption rollup. Credentials, signing secrets, keys,
-- disabling and removal are a SUPER_ADMIN's. Platform data: only the Super Admin team and the
-- platform's services reach it. Contract note: docs/work/R0-stage-b8-integrations.md.

-- CreateEnum
CREATE TYPE "PlatformIntegrationCategory" AS ENUM ('PAYMENTS_BILLING', 'COMMUNICATION', 'EMAIL', 'CLOUD_STORAGE', 'AI_AUTOMATION', 'MLS_DATA', 'ESIGN', 'SECURITY_INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformIntegrationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION', 'ERROR', 'DISABLED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PlatformIntegrationRunKind" AS ENUM ('SYNC', 'TEST');

-- CreateEnum
CREATE TYPE "PlatformIntegrationLogSource" AS ENUM ('PLATFORM_INTEGRATION', 'FIRM_CONNECTION', 'API', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "PlatformIntegrationLogSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PlatformCatalogStatus" AS ENUM ('ENABLED', 'COMING_SOON', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlatformCatalogPlanAccess" AS ENUM ('ALL_PLANS', 'SELECTED_PLANS');

-- CreateEnum
CREATE TYPE "PlatformCatalogFirmAccess" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "PlatformWebhookDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "PlatformWebhookStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlatformDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlatformUsageScope" AS ENUM ('PLATFORM_INTEGRATION', 'CATALOG', 'API');

-- CreateTable
CREATE TABLE "platform_integrations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PlatformIntegrationCategory" NOT NULL,
    "description" TEXT,
    "website_url" TEXT,
    "docs_url" TEXT,
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'TEST',
    "status" "PlatformIntegrationStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "secret_ref" TEXT,
    "secret_rotated_at" TIMESTAMPTZ(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "last_check_at" TIMESTAMPTZ(3),
    "last_check_ok" BOOLEAN,
    "last_sync_at" TIMESTAMPTZ(3),
    "activated_without_test" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_runs" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "kind" "PlatformIntegrationRunKind" NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "correlation_id" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_integration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_logs" (
    "id" UUID NOT NULL,
    "source" "PlatformIntegrationLogSource" NOT NULL,
    "integration_id" UUID,
    "provider" TEXT,
    "environment" "IntegrationEnvironment",
    "severity" "PlatformIntegrationLogSeverity" NOT NULL,
    "event_type" TEXT NOT NULL,
    "action" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "subject_business_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_catalog" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PlatformIntegrationCategory" NOT NULL,
    "short_description" TEXT NOT NULL,
    "description" TEXT,
    "logo_s3_key" TEXT,
    "website_url" TEXT,
    "help_url" TEXT,
    "status" "PlatformCatalogStatus" NOT NULL DEFAULT 'DISABLED',
    "plan_access" "PlatformCatalogPlanAccess" NOT NULL DEFAULT 'ALL_PLANS',
    "setup" JSONB NOT NULL DEFAULT '{}',
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "advanced" JSONB NOT NULL DEFAULT '{}',
    "platform_integration_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_integration_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_catalog_plans" (
    "catalog_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_integration_catalog_plans_pkey" PRIMARY KEY ("catalog_id","plan_id")
);

-- CreateTable
CREATE TABLE "platform_integration_catalog_firms" (
    "catalog_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "access" "PlatformCatalogFirmAccess" NOT NULL,
    "reason" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_integration_catalog_firms_pkey" PRIMARY KEY ("catalog_id","business_id")
);

-- CreateTable
CREATE TABLE "platform_api_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'TEST',
    "rate_limit_per_minute" INTEGER,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "rotated_from_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_webhook_endpoints" (
    "id" UUID NOT NULL,
    "direction" "PlatformWebhookDirection" NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signing_secret_ref" TEXT,
    "secret_rotated_at" TIMESTAMPTZ(3),
    "status" "PlatformWebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_retries" INTEGER NOT NULL DEFAULT 5,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "redelivery_of_id" UUID,
    "status" "PlatformDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "response_status_code" INTEGER,
    "duration_ms" INTEGER,
    "request_id" TEXT,
    "error_code" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_integration_usage_daily" (
    "day" DATE NOT NULL,
    "scope" "PlatformUsageScope" NOT NULL,
    "subject_key" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "avg_latency_ms" INTEGER,
    "volume" BIGINT,
    "cost_cents" INTEGER,
    "connected_firms" INTEGER,
    "active_firms" INTEGER,
    "connects" INTEGER,
    "disconnects" INTEGER,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_integration_usage_daily_pkey" PRIMARY KEY ("day","scope","subject_key")
);

-- CreateIndex
CREATE INDEX "platform_integrations_provider_environment_idx" ON "platform_integrations"("provider", "environment");

-- CreateIndex
CREATE INDEX "platform_integrations_status_idx" ON "platform_integrations"("status");

-- CreateIndex
CREATE INDEX "platform_integration_runs_integration_id_created_at_idx" ON "platform_integration_runs"("integration_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_integration_runs_status_idx" ON "platform_integration_runs"("status");

-- CreateIndex
CREATE INDEX "platform_integration_logs_created_at_idx" ON "platform_integration_logs"("created_at");

-- CreateIndex
CREATE INDEX "platform_integration_logs_integration_id_created_at_idx" ON "platform_integration_logs"("integration_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_integration_logs_severity_created_at_idx" ON "platform_integration_logs"("severity", "created_at");

-- CreateIndex
CREATE INDEX "platform_integration_logs_provider_created_at_idx" ON "platform_integration_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "platform_integration_logs_correlation_id_idx" ON "platform_integration_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "platform_integration_logs_request_id_idx" ON "platform_integration_logs"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_integration_catalog_provider_key" ON "platform_integration_catalog"("provider");

-- CreateIndex
CREATE INDEX "platform_integration_catalog_status_sort_order_idx" ON "platform_integration_catalog"("status", "sort_order");

-- CreateIndex
CREATE INDEX "platform_integration_catalog_plans_plan_id_idx" ON "platform_integration_catalog_plans"("plan_id");

-- CreateIndex
CREATE INDEX "platform_integration_catalog_firms_business_id_idx" ON "platform_integration_catalog_firms"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_api_keys_key_hash_key" ON "platform_api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_api_keys_rotated_from_id_key" ON "platform_api_keys"("rotated_from_id");

-- CreateIndex
CREATE INDEX "platform_api_keys_revoked_at_idx" ON "platform_api_keys"("revoked_at");

-- CreateIndex
CREATE INDEX "platform_webhook_endpoints_direction_status_idx" ON "platform_webhook_endpoints"("direction", "status");

-- CreateIndex
CREATE INDEX "platform_webhook_deliveries_endpoint_id_created_at_idx" ON "platform_webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_webhook_deliveries_status_idx" ON "platform_webhook_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_webhook_deliveries_endpoint_id_event_id_attempt_key" ON "platform_webhook_deliveries"("endpoint_id", "event_id", "attempt");

-- CreateIndex
CREATE INDEX "platform_integration_usage_daily_scope_subject_key_day_idx" ON "platform_integration_usage_daily"("scope", "subject_key", "day");

-- AddForeignKey
ALTER TABLE "platform_integration_runs" ADD CONSTRAINT "platform_integration_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "platform_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_logs" ADD CONSTRAINT "platform_integration_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "platform_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_catalog" ADD CONSTRAINT "platform_integration_catalog_platform_integration_id_fkey" FOREIGN KEY ("platform_integration_id") REFERENCES "platform_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_catalog_plans" ADD CONSTRAINT "platform_integration_catalog_plans_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "platform_integration_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_catalog_plans" ADD CONSTRAINT "platform_integration_catalog_plans_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_catalog_firms" ADD CONSTRAINT "platform_integration_catalog_firms_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "platform_integration_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_integration_catalog_firms" ADD CONSTRAINT "platform_integration_catalog_firms_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_api_keys" ADD CONSTRAINT "platform_api_keys_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "platform_api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_webhook_deliveries" ADD CONSTRAINT "platform_webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "platform_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_webhook_deliveries" ADD CONSTRAINT "platform_webhook_deliveries_redelivery_of_id_fkey" FOREIGN KEY ("redelivery_of_id") REFERENCES "platform_webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
CREATE FUNCTION integrations_url_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT char_length(v) <= 2048 AND v ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' $$;

-- A secret is referenced, never stored: an AWS Secrets Manager ARN, or local:<name> in development.
CREATE FUNCTION integrations_secret_ref_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT char_length(v) <= 600
               AND v ~ '^(arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+|local:[a-z0-9_.-]{1,100})$' $$;

-- A list of keys (scopes, events, badges): lowercase, at most n of them, none null or blank.
CREATE FUNCTION integrations_keys_ok(keys text[], n integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(keys) <= n
               AND NOT EXISTS (SELECT 1 FROM unnest(keys) k WHERE k IS NULL OR k !~ '^[a-z][a-z0-9_.:-]{0,79}$') $$;

ALTER TABLE platform_integrations ADD CONSTRAINT platform_integrations_values
  CHECK (provider ~ '^[a-z][a-z0-9_]{0,59}$' AND platform_text_ok(name, 120)
         AND (description IS NULL OR platform_text_ok(description, 2000))
         AND (website_url IS NULL OR integrations_url_ok(website_url))
         AND (docs_url IS NULL OR integrations_url_ok(docs_url))
         AND (status_reason IS NULL OR status_reason ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (secret_ref IS NULL OR integrations_secret_ref_ok(secret_ref))
         AND (secret_rotated_at IS NULL OR secret_ref IS NOT NULL)
         AND jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 16384
         AND (last_check_at IS NULL) = (last_check_ok IS NULL)
         AND version >= 1
         AND (status <> 'DRAFT' OR activated_at IS NULL)
         AND (status NOT IN ('ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION', 'ERROR') OR activated_at IS NOT NULL)
         AND (status <> 'DISABLED' OR disabled_at IS NOT NULL)
         AND (status = 'REMOVED') = (removed_at IS NOT NULL));

ALTER TABLE platform_integration_runs ADD CONSTRAINT platform_integration_runs_values
  CHECK (object_count >= 0 AND failed_count >= 0 AND retries BETWEEN 0 AND 100
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (error_message IS NULL OR platform_text_ok(error_message, 1000))
         AND (correlation_id IS NULL OR correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$')
         AND (CASE status
                WHEN 'QUEUED' THEN started_at IS NULL AND finished_at IS NULL
                WHEN 'RUNNING' THEN started_at IS NOT NULL AND finished_at IS NULL
                WHEN 'FAILED' THEN finished_at IS NOT NULL AND error_code IS NOT NULL
                ELSE finished_at IS NOT NULL END));

ALTER TABLE platform_integration_logs ADD CONSTRAINT platform_integration_logs_values
  CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
         AND (action IS NULL OR action ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (provider IS NULL OR provider ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND platform_text_ok(message, 2000)
         AND (details IS NULL OR (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 16384))
         AND (request_id IS NULL OR request_id ~ '^[A-Za-z0-9._:-]{1,128}$')
         AND (correlation_id IS NULL OR correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$')
         AND (source <> 'PLATFORM_INTEGRATION' OR integration_id IS NOT NULL)
         AND (source <> 'FIRM_CONNECTION' OR (provider IS NOT NULL AND subject_business_id IS NOT NULL)));

ALTER TABLE platform_integration_catalog ADD CONSTRAINT platform_integration_catalog_values
  CHECK (provider ~ '^[a-z][a-z0-9_]{0,59}$' AND platform_text_ok(name, 120)
         AND platform_text_ok(short_description, 200)
         AND (description IS NULL OR platform_text_ok(description, 5000))
         AND (logo_s3_key IS NULL OR (starts_with(logo_s3_key, 'platform/integrations/' || id || '/')
                                      AND logo_s3_key ~ '^[A-Za-z0-9/._-]+\.(png|webp|jpg|jpeg)$'
                                      AND logo_s3_key !~ '(^|/)\.\.?(/|$)'))
         AND (website_url IS NULL OR integrations_url_ok(website_url))
         AND (help_url IS NULL OR integrations_url_ok(help_url))
         AND jsonb_typeof(setup) = 'object' AND octet_length(setup::text) <= 16384
         AND jsonb_typeof(advanced) = 'object' AND octet_length(advanced::text) <= 16384
         AND integrations_keys_ok(badges, 10)
         AND version >= 1);

ALTER TABLE platform_integration_catalog_firms ADD CONSTRAINT platform_integration_catalog_firms_values
  CHECK (reason IS NULL OR platform_text_ok(reason, 1000));

-- A key's prefix names its environment; only its hash is stored.
ALTER TABLE platform_api_keys ADD CONSTRAINT platform_api_keys_values
  CHECK (platform_text_ok(name, 120)
         AND prefix ~ ('^fv_' || lower(environment::text) || '_[a-z0-9]{4,12}$')
         AND last_four ~ '^[A-Za-z0-9]{4}$' AND key_hash ~ '^[0-9a-f]{64}$'
         AND integrations_keys_ok(scopes, 50)
         AND (rate_limit_per_minute IS NULL OR rate_limit_per_minute BETWEEN 1 AND 100000)
         AND (expires_at IS NULL OR expires_at > created_at)
         AND (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL)
         AND (rotated_from_id IS NULL OR rotated_from_id <> id));

ALTER TABLE platform_webhook_endpoints ADD CONSTRAINT platform_webhook_endpoints_values
  CHECK (integrations_url_ok(url) AND (description IS NULL OR platform_text_ok(description, 500))
         AND integrations_keys_ok(events, 100)
         AND (signing_secret_ref IS NULL OR integrations_secret_ref_ok(signing_secret_ref))
         AND (secret_rotated_at IS NULL OR signing_secret_ref IS NOT NULL)
         AND max_retries BETWEEN 0 AND 10);

ALTER TABLE platform_webhook_deliveries ADD CONSTRAINT platform_webhook_deliveries_values
  CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
         AND btrim(event_id) <> '' AND char_length(event_id) <= 200
         AND attempt BETWEEN 1 AND 100
         AND (response_status_code IS NULL OR response_status_code BETWEEN 100 AND 599)
         AND (duration_ms IS NULL OR duration_ms >= 0)
         AND (request_id IS NULL OR request_id ~ '^[A-Za-z0-9._:-]{1,128}$')
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (status = 'PENDING') = (finished_at IS NULL)
         AND (status <> 'FAILED' OR error_code IS NOT NULL OR response_status_code IS NOT NULL)
         AND (redelivery_of_id IS NULL OR redelivery_of_id <> id));

ALTER TABLE platform_integration_usage_daily ADD CONSTRAINT platform_integration_usage_daily_values
  CHECK (btrim(subject_key) <> '' AND char_length(subject_key) <= 100
         AND requests >= 0 AND successes >= 0 AND failures >= 0
         AND (avg_latency_ms IS NULL OR avg_latency_ms >= 0) AND (volume IS NULL OR volume >= 0)
         AND (cost_cents IS NULL OR cost_cents >= 0)
         AND (connected_firms IS NULL OR connected_firms >= 0) AND (active_firms IS NULL OR active_firms >= 0)
         AND (connects IS NULL OR connects >= 0) AND (disconnects IS NULL OR disconnects >= 0));

-- ---------- Rules ----------
-- Platform integrations. A draft becomes ACTIVE only after a passing test (or with the admin's
-- confirmation that the provider has none); health moves it among ACTIVE, INACTIVE,
-- NEEDS_ATTENTION and ERROR; only a SUPER_ADMIN disables, re-enables or removes it, or sets its
-- credentials. REMOVED is final (a tombstone). One live connection per provider and environment.
CREATE FUNCTION platform_integrations_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'integrations: a new integration starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.secret_ref IS NOT NULL AND NOT app_is_admin() THEN
      RAISE EXCEPTION 'integrations: only a SUPER_ADMIN sets credentials' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.secret_rotated_at := CASE WHEN NEW.secret_ref IS NOT NULL THEN now() END;
    NEW.activated_at := NULL;
    NEW.disabled_at := NULL;
    NEW.removed_at := NULL;
    NEW.version := 1;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.updated_by_user_id := app_current_admin_id();
  ELSE
    IF OLD.status = 'REMOVED' THEN
      RAISE EXCEPTION 'integrations: a removed integration never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.id, NEW.provider, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.provider, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'integrations: an integration keeps its provider' USING ERRCODE = 'check_violation';
    END IF;
    NEW.activated_at := OLD.activated_at;
    NEW.disabled_at := OLD.disabled_at;
    NEW.removed_at := OLD.removed_at;
    NEW.secret_rotated_at := OLD.secret_rotated_at;
    IF NEW.secret_ref IS DISTINCT FROM OLD.secret_ref THEN
      IF NOT app_is_admin() THEN
        RAISE EXCEPTION 'integrations: only a SUPER_ADMIN sets credentials' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.secret_rotated_at := CASE WHEN NEW.secret_ref IS NOT NULL THEN now() END;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('DISABLED', 'REMOVED') OR OLD.status = 'DISABLED' THEN
        IF NOT app_is_admin() THEN
          RAISE EXCEPTION 'integrations: only a SUPER_ADMIN disables, re-enables or removes an integration'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
      ELSIF OLD.status = 'DRAFT' AND NEW.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'integrations: a draft is activated, or removed' USING ERRCODE = 'check_violation';
      ELSIF NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'integrations: an integration never goes back to draft' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
        IF NOT (coalesce(NEW.last_check_ok, false) OR NEW.activated_without_test) THEN
          RAISE EXCEPTION 'integrations: activate after a passing connection test' USING ERRCODE = 'check_violation';
        END IF;
        NEW.activated_at := now();
      END IF;
      IF NEW.status = 'DISABLED' THEN NEW.disabled_at := now(); END IF;
      IF NEW.status = 'REMOVED' THEN NEW.removed_at := now(); END IF;
      IF OLD.status = 'DISABLED' AND NEW.status <> 'REMOVED' AND OLD.activated_at IS NULL THEN
        RAISE EXCEPTION 'integrations: a draft that was disabled is removed, not re-enabled'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.activated_without_test IS DISTINCT FROM OLD.activated_without_test AND OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'integrations: the test confirmation comes with activation' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.name, NEW.category, NEW.description, NEW.website_url, NEW.docs_url, NEW.environment,
        NEW.secret_ref, NEW.settings, NEW.status)
       IS DISTINCT FROM
       (OLD.name, OLD.category, OLD.description, OLD.website_url, OLD.docs_url, OLD.environment,
        OLD.secret_ref, OLD.settings, OLD.status) THEN
      NEW.version := OLD.version + 1;
    ELSE
      NEW.version := OLD.version;
    END IF;
    NEW.updated_by_user_id := coalesce(app_current_admin_id(), OLD.updated_by_user_id);
  END IF;
  IF NEW.status <> 'REMOVED' AND (TG_OP = 'INSERT' OR NEW.environment IS DISTINCT FROM OLD.environment) THEN
    PERFORM 1 FROM platform_integrations
    WHERE provider = NEW.provider AND environment = NEW.environment AND status <> 'REMOVED' AND id <> NEW.id;
    IF FOUND THEN
      RAISE EXCEPTION 'integrations: % already has a % connection', NEW.provider, NEW.environment
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integrations_rules BEFORE INSERT OR UPDATE ON platform_integrations
  FOR EACH ROW EXECUTE FUNCTION platform_integrations_rules();

-- Runs: queued by the team or the scheduler; QUEUED -> RUNNING -> SUCCEEDED, PARTIAL or FAILED,
-- moved only by the worker (platform scope), which stamps the times. What was asked never changes.
CREATE FUNCTION platform_integration_runs_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' THEN
      RAISE EXCEPTION 'integrations: a run starts QUEUED' USING ERRCODE = 'check_violation';
    END IF;
    NEW.requested_by_user_id := app_current_admin_id();
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.integration_id, NEW.kind, NEW.requested_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.integration_id, OLD.kind, OLD.requested_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'integrations: a run''s request never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('QUEUED', 'RUNNING') THEN
    RAISE EXCEPTION 'integrations: a finished run never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(app_scope(), '') <> 'platform' THEN
    RAISE EXCEPTION 'integrations: only the worker moves a run' USING ERRCODE = 'check_violation';
  END IF;
  NEW.started_at := OLD.started_at;
  NEW.finished_at := OLD.finished_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING', 'FAILED'))
            OR (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'PARTIAL', 'FAILED'))) THEN
      RAISE EXCEPTION 'integrations: a % run cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'RUNNING' THEN NEW.started_at := now(); ELSE NEW.finished_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integration_runs_rules BEFORE INSERT OR UPDATE ON platform_integration_runs
  FOR EACH ROW EXECUTE FUNCTION platform_integration_runs_rules();

-- The log is insert-only; the database stamps the time for the app role and the actor in admin
-- scope (the owner may write past events for demo history).
CREATE FUNCTION platform_integration_logs_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF current_user = 'firmivra_app' THEN
    NEW.created_at := now();
  END IF;
  IF app_current_admin_id() IS NOT NULL THEN
    NEW.actor_user_id := app_current_admin_id();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integration_logs_stamp BEFORE INSERT ON platform_integration_logs
  FOR EACH ROW EXECUTE FUNCTION platform_integration_logs_stamp();

-- Catalog entries: the provider key never changes; every save is a new version, stamped.
CREATE FUNCTION platform_integration_catalog_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSE
    IF (NEW.id, NEW.provider, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.provider, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'integrations: a catalog entry keeps its provider' USING ERRCODE = 'check_violation';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_by_user_id := app_current_admin_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integration_catalog_rules BEFORE INSERT OR UPDATE ON platform_integration_catalog
  FOR EACH ROW EXECUTE FUNCTION platform_integration_catalog_rules();

CREATE FUNCTION platform_integration_catalog_firms_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF (NEW.catalog_id, NEW.business_id, NEW.created_at) IS DISTINCT FROM (OLD.catalog_id, OLD.business_id, OLD.created_at) THEN
    RAISE EXCEPTION 'integrations: a firm rule stays on its entry and firm' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by_user_id := app_current_admin_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integration_catalog_firms_rules BEFORE INSERT OR UPDATE ON platform_integration_catalog_firms
  FOR EACH ROW EXECUTE FUNCTION platform_integration_catalog_firms_rules();

-- API keys: issued by a SUPER_ADMIN (the RLS policy); a rotation names a key that is still live.
-- Afterwards only the platform records the last use, and a key is revoked once (stamped).
CREATE FUNCTION platform_api_keys_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION 'integrations: a new key is live and unused' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.rotated_from_id IS NOT NULL THEN
      PERFORM 1 FROM platform_api_keys WHERE id = NEW.rotated_from_id AND revoked_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'integrations: a rotation replaces a live key' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.revoked_by_user_id := NULL;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.name, NEW.prefix, NEW.last_four, NEW.key_hash, NEW.scopes, NEW.environment,
      NEW.rate_limit_per_minute, NEW.expires_at, NEW.rotated_from_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.name, OLD.prefix, OLD.last_four, OLD.key_hash, OLD.scopes, OLD.environment,
      OLD.rate_limit_per_minute, OLD.expires_at, OLD.rotated_from_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'integrations: a key never changes; rotate it instead' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at AND coalesce(app_scope(), '') <> 'platform' THEN
    RAISE EXCEPTION 'integrations: only the platform records a key''s use' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'integrations: a key is revoked once' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (app_is_admin() OR coalesce(app_scope(), '') = 'platform') THEN
      RAISE EXCEPTION 'integrations: only a SUPER_ADMIN revokes a key' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.revoked_at := now();
    NEW.revoked_by_user_id := app_current_admin_id();
  ELSE
    NEW.revoked_by_user_id := OLD.revoked_by_user_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_api_keys_rules BEFORE INSERT OR UPDATE ON platform_api_keys
  FOR EACH ROW EXECUTE FUNCTION platform_api_keys_rules();

-- Webhook endpoints: only a SUPER_ADMIN sets the signing secret's reference (a new one is a
-- rotation, stamped); the database stamps who and when.
CREATE FUNCTION platform_webhook_endpoints_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSIF (NEW.id, NEW.direction, NEW.created_at, NEW.created_by_user_id)
        IS DISTINCT FROM (OLD.id, OLD.direction, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'integrations: an endpoint keeps its direction' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.signing_secret_ref IS NOT NULL
     OR TG_OP = 'UPDATE' AND NEW.signing_secret_ref IS DISTINCT FROM OLD.signing_secret_ref THEN
    IF NOT app_is_admin() THEN
      RAISE EXCEPTION 'integrations: only a SUPER_ADMIN sets a signing secret' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.secret_rotated_at := CASE WHEN NEW.signing_secret_ref IS NOT NULL THEN now() END;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.secret_rotated_at := OLD.secret_rotated_at;
  ELSE
    NEW.secret_rotated_at := NULL;
  END IF;
  NEW.updated_by_user_id := app_current_admin_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_webhook_endpoints_rules BEFORE INSERT OR UPDATE ON platform_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION platform_webhook_endpoints_rules();

-- Deliveries: one attempt each, PENDING until the platform writes its result once. A redelivery
-- (the team's, after confirmation) is a later attempt of the same event to the same endpoint.
CREATE FUNCTION platform_webhook_deliveries_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  orig record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'integrations: a delivery starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.redelivery_of_id IS NOT NULL THEN
      SELECT endpoint_id, event_id, event_type, attempt INTO orig FROM platform_webhook_deliveries
      WHERE id = NEW.redelivery_of_id;
      IF orig.endpoint_id IS DISTINCT FROM NEW.endpoint_id OR orig.event_id IS DISTINCT FROM NEW.event_id
         OR orig.event_type IS DISTINCT FROM NEW.event_type OR NEW.attempt <= orig.attempt THEN
        RAISE EXCEPTION 'integrations: a redelivery is a later attempt of the same event to the same endpoint'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.requested_by_user_id := app_current_admin_id();
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.endpoint_id, NEW.event_type, NEW.event_id, NEW.attempt, NEW.redelivery_of_id,
      NEW.requested_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.endpoint_id, OLD.event_type, OLD.event_id, OLD.attempt, OLD.redelivery_of_id,
      OLD.requested_by_user_id, OLD.created_at)
     OR OLD.status <> 'PENDING' OR coalesce(app_scope(), '') <> 'platform' THEN
    RAISE EXCEPTION 'integrations: only the platform writes a delivery''s result, once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.finished_at := CASE WHEN NEW.status = 'PENDING' THEN NULL ELSE now() END;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_webhook_deliveries_rules BEFORE INSERT OR UPDATE ON platform_webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION platform_webhook_deliveries_rules();

CREATE FUNCTION platform_integration_usage_daily_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.computed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_integration_usage_daily_stamp BEFORE INSERT OR UPDATE ON platform_integration_usage_daily
  FOR EACH ROW EXECUTE FUNCTION platform_integration_usage_daily_stamp();

-- ---------- Grants ----------
-- Integrations are removed as tombstones, endpoints disabled, keys revoked: none deleted. The log is
-- insert-only.
GRANT SELECT, INSERT, UPDATE ON platform_integrations, platform_integration_runs,
  platform_integration_catalog, platform_api_keys, platform_webhook_endpoints,
  platform_webhook_deliveries, platform_integration_usage_daily TO firmivra_app;
GRANT SELECT, INSERT ON platform_integration_logs TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON platform_integration_catalog_plans TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_integration_catalog_firms TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_integrations', 'platform_integration_runs', 'platform_integration_logs',
    'platform_integration_catalog', 'platform_integration_catalog_plans', 'platform_integration_catalog_firms',
    'platform_api_keys', 'platform_webhook_endpoints', 'platform_webhook_deliveries',
    'platform_integration_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's services (sync and webhook workers,
-- health checks, the daily rollup: platform scope). Which team member may view, manage or test is
-- the API's integrations.* check; credentials, signing secrets, keys, disabling and removal are a
-- SUPER_ADMIN's (the triggers and the key policy). Only the platform writes the usage rollup. No
-- firm scope reaches any table.
CREATE FUNCTION app_is_integrations_team() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_integrations', 'platform_integration_runs', 'platform_integration_logs',
    'platform_integration_catalog', 'platform_integration_catalog_plans', 'platform_integration_catalog_firms',
    'platform_webhook_endpoints', 'platform_webhook_deliveries'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_integrations_team()) '
                   'WITH CHECK (app_is_integrations_team())', t || '_team', t);
  END LOOP;
END
$$;

CREATE POLICY platform_api_keys_read ON platform_api_keys FOR SELECT USING (app_is_integrations_team());
CREATE POLICY platform_api_keys_issue ON platform_api_keys FOR INSERT WITH CHECK (app_is_admin());
CREATE POLICY platform_api_keys_update ON platform_api_keys FOR UPDATE
  USING (app_is_admin() OR app_scope() = 'platform') WITH CHECK (app_is_admin() OR app_scope() = 'platform');

CREATE POLICY platform_integration_usage_daily_read ON platform_integration_usage_daily FOR SELECT
  USING (app_is_integrations_team());
CREATE POLICY platform_integration_usage_daily_write ON platform_integration_usage_daily FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY platform_integration_usage_daily_update ON platform_integration_usage_daily FOR UPDATE
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
