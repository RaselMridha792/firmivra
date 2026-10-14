-- R38 (Rasel, Oct 14), Bookkeeping, part 2: accounting-system connections, their sync runs and
-- a client's bank and credit card accounts (docs/mockups/firm-workspace/bookkeeping/source,
-- list, workspace Overview and the guides' integration rules). Providers are codes, so more can
-- be added; a token is never stored here (credential_ref points into the secret store); a
-- provider company has one live connection; a failed sync never erases the last good sync date;
-- an account keeps only its last digits. No ledger data: this is the connection state, not a sync.

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('INITIAL', 'MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SyncOutcome" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "BookkeepingAccountType" AS ENUM ('BANK', 'CREDIT_CARD', 'LOAN', 'OTHER');

-- CreateTable
CREATE TABLE "bookkeeping_connections" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_company_id" TEXT NOT NULL,
    "company_name" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "credential_ref" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_successful_sync_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "connected_by_user_id" UUID,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_sync_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "outcome" "SyncOutcome" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "message" TEXT,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "requested_by_user_id" UUID,

    CONSTRAINT "bookkeeping_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "connection_id" UUID,
    "name" TEXT NOT NULL,
    "type" "BookkeepingAccountType" NOT NULL,
    "institution" TEXT,
    "mask" TEXT,
    "source_account_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "balance_cents" INTEGER,
    "balance_as_of" TIMESTAMPTZ(3),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "reconcile" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookkeeping_connections_business_id_engagement_id_idx" ON "bookkeeping_connections"("business_id", "engagement_id");

-- CreateIndex
CREATE INDEX "bookkeeping_connections_business_id_status_idx" ON "bookkeeping_connections"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_connections_business_id_id_key" ON "bookkeeping_connections"("business_id", "id");

-- CreateIndex
CREATE INDEX "bookkeeping_sync_runs_business_id_connection_id_started_at_idx" ON "bookkeeping_sync_runs"("business_id", "connection_id", "started_at");

-- CreateIndex
CREATE INDEX "bookkeeping_accounts_business_id_engagement_id_idx" ON "bookkeeping_accounts"("business_id", "engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_accounts_business_id_id_key" ON "bookkeeping_accounts"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_accounts_business_id_engagement_id_connection_i_key" ON "bookkeeping_accounts"("business_id", "engagement_id", "connection_id", "source_account_id");

-- AddForeignKey
ALTER TABLE "bookkeeping_connections" ADD CONSTRAINT "bookkeeping_connections_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_sync_runs" ADD CONSTRAINT "bookkeeping_sync_runs_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "bookkeeping_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_accounts" ADD CONSTRAINT "bookkeeping_accounts_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_accounts" ADD CONSTRAINT "bookkeeping_accounts_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "bookkeeping_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Connections are disconnected, accounts archived, sync runs kept: nothing is deleted.
GRANT SELECT, INSERT, UPDATE ON bookkeeping_connections, bookkeeping_sync_runs,
  bookkeeping_accounts TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookkeeping_connections', 'bookkeeping_sync_runs',
    'bookkeeping_accounts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE bookkeeping_connections ADD CONSTRAINT bookkeeping_connections_shape
  CHECK (provider ~ '^[a-z][a-z0-9_]{1,39}$'
         AND btrim(provider_company_id) <> '' AND char_length(provider_company_id) <= 120
         AND char_length(company_name) <= 200 AND char_length(last_error_code) <= 60
         -- A secret-store reference: a path or name, with no spaces, never a token's text.
         AND (credential_ref IS NULL OR (credential_ref ~ '^[A-Za-z0-9/_.:-]+$' AND char_length(credential_ref) <= 200))
         AND ((status = 'DISCONNECTED') = (disconnected_at IS NOT NULL))
         AND (last_successful_sync_at IS NULL OR last_sync_at IS NOT NULL));
-- One live connection per provider company (in the firm) and per client and provider.
CREATE UNIQUE INDEX bookkeeping_connections_one_per_company
  ON bookkeeping_connections (business_id, provider, provider_company_id)
  WHERE status <> 'DISCONNECTED';
CREATE UNIQUE INDEX bookkeeping_connections_one_per_client
  ON bookkeeping_connections (business_id, engagement_id, provider)
  WHERE status <> 'DISCONNECTED';

ALTER TABLE bookkeeping_sync_runs ADD CONSTRAINT bookkeeping_sync_runs_shape
  CHECK (char_length(error_code) <= 60 AND char_length(message) <= 300
         AND jsonb_typeof(counts) = 'object' AND pg_column_size(counts) <= 2000
         AND ((outcome = 'RUNNING') = (finished_at IS NULL))
         AND (finished_at IS NULL OR finished_at >= started_at)
         AND (outcome IN ('FAILED', 'PARTIAL') OR error_code IS NULL));

ALTER TABLE bookkeeping_accounts ADD CONSTRAINT bookkeeping_accounts_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND char_length(institution) <= 120
         AND (mask IS NULL OR mask ~ '^[0-9A-Za-z]{2,4}$')
         AND (source_account_id IS NULL OR (btrim(source_account_id) <> '' AND char_length(source_account_id) <= 120))
         AND currency ~ '^[a-z]{3}$'
         AND (balance_cents IS NULL) = (balance_as_of IS NULL)
         AND (source_account_id IS NULL) = (connection_id IS NULL));

-- ---------- Rules ----------
-- A connection or account is of an engagement that has a bookkeeping profile; a connection
-- keeps its client, provider and company, and a good sync date only moves forward.
CREATE FUNCTION bookkeeping_connections_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
       WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping: a connection belongs to an engagement with a bookkeeping profile'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.engagement_id, NEW.provider, NEW.provider_company_id)
       IS DISTINCT FROM (OLD.engagement_id, OLD.provider, OLD.provider_company_id) THEN
      RAISE EXCEPTION 'bookkeeping: a connection keeps its client, provider and company'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.last_successful_sync_at IS NOT NULL
       AND (NEW.last_successful_sync_at IS NULL OR NEW.last_successful_sync_at < OLD.last_successful_sync_at) THEN
      RAISE EXCEPTION 'bookkeeping: a failed sync never erases the last successful sync'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_connections_rules BEFORE INSERT OR UPDATE ON bookkeeping_connections
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_connections_rules();

CREATE FUNCTION bookkeeping_accounts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.engagement_id <> OLD.engagement_id THEN
    RAISE EXCEPTION 'bookkeeping: an account cannot move to another client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
       WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping: an account belongs to an engagement with a bookkeeping profile'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.connection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookkeeping_connections c
       WHERE c.business_id = NEW.business_id AND c.id = NEW.connection_id
         AND c.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping: an account''s connection is its own client''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_accounts_rules BEFORE INSERT OR UPDATE ON bookkeeping_accounts
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_accounts_rules();
