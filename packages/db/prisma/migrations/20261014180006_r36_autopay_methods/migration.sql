-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "client_payment_methods" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE',
    "customer_ref" TEXT NOT NULL,
    "method_ref" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "method_type" TEXT NOT NULL,
    "card_brand" TEXT,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER,
    "exp_year" INTEGER,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "authorized_at" TIMESTAMPTZ(3) NOT NULL,
    "authorized_by_user_id" UUID,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_payment_methods_business_id_client_id_status_idx" ON "client_payment_methods"("business_id", "client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_payment_methods_processor_method_ref_key" ON "client_payment_methods"("processor", "method_ref");

-- CreateIndex
CREATE UNIQUE INDEX "client_payment_methods_business_id_id_key" ON "client_payment_methods"("business_id", "id");

-- AddForeignKey
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_business_id_authorized_by_user_id_fkey" FOREIGN KEY ("business_id", "authorized_by_user_id") REFERENCES "client_accounts"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the payment method a client saved for AutoPay (Stripe's references and what
-- the screens show, never a number), with who authorized charging it and when.

-- ---------- Grants and RLS: only the firm's own business scope; removed, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON client_payment_methods TO firmivra_app;
ALTER TABLE client_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_payment_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY client_payment_methods_business ON client_payment_methods
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE client_payment_methods
  ADD CONSTRAINT client_payment_methods_refs
    CHECK (customer_ref ~ '^cus_[A-Za-z0-9]+$' AND method_ref ~ '^pm_[A-Za-z0-9]+$'
           AND account_id ~ '^acct_[A-Za-z0-9]+$'),
  -- Only what the screens show: the type, the card brand, the last 4 digits and the expiry.
  ADD CONSTRAINT client_payment_methods_details
    CHECK (method_type ~ '^[a-z_]{1,30}$' AND last4 ~ '^[0-9]{4}$'
           AND (card_brand IS NULL OR (method_type = 'card' AND card_brand ~ '^[a-z_]{1,30}$'))
           AND (exp_month IS NULL) = (exp_year IS NULL)
           AND (exp_month IS NULL OR (exp_month BETWEEN 1 AND 12 AND exp_year BETWEEN 2000 AND 2200))),
  ADD CONSTRAINT client_payment_methods_removed CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL)),
  ADD CONSTRAINT client_payment_methods_default CHECK (NOT is_default OR status = 'ACTIVE');
CREATE UNIQUE INDEX client_payment_methods_one_default
  ON client_payment_methods (business_id, client_id) WHERE is_default AND status = 'ACTIVE';

-- ---------- Rules ----------
-- A saved method is on the firm's own Stripe account; only its default flag, expiry and removal
-- change afterwards, and a removed one stays removed.
CREATE FUNCTION client_payment_methods_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM stripe_accounts a
                   WHERE a.business_id = NEW.business_id AND a.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'payment methods: a method is saved on the firm''s own Stripe account'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'is_default', 'exp_month', 'exp_year', 'removed_at', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'is_default', 'exp_month', 'exp_year', 'removed_at', 'updated_at']) THEN
    RAISE EXCEPTION 'payment methods: only the default, the expiry and the removal change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REMOVED' AND NEW.status <> 'REMOVED' THEN
    RAISE EXCEPTION 'payment methods: a removed method stays removed; the client saves it again'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_payment_methods_rules
  BEFORE INSERT OR UPDATE ON client_payment_methods
  FOR EACH ROW EXECUTE FUNCTION client_payment_methods_rules();
