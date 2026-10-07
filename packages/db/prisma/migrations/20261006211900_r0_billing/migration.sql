-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProcessor" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('RESOURCE', 'TIP', 'EXTERNAL_LINK');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" DATE,
    "due_on" DATE,
    "issued_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_amount_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE',
    "processor_ref" TEXT NOT NULL,
    "failure_code" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE',
    "processor_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculator_definitions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "disclaimer" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calculator_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_business_id_client_id_status_idx" ON "invoices"("business_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "invoices_business_id_status_due_on_idx" ON "invoices"("business_id", "status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_number_key" ON "invoices"("business_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_id_key" ON "invoices"("business_id", "id");

-- CreateIndex
CREATE INDEX "invoice_lines_business_id_invoice_id_idx" ON "invoice_lines"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_business_id_invoice_id_idx" ON "payments"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_processor_processor_ref_key" ON "payments"("processor", "processor_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_id_key" ON "payments"("business_id", "id");

-- CreateIndex
CREATE INDEX "payment_events_business_id_payment_id_idx" ON "payment_events"("business_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_processor_processor_event_id_key" ON "payment_events"("processor", "processor_event_id");

-- CreateIndex
CREATE INDEX "content_items_business_id_kind_category_sort_order_idx" ON "content_items"("business_id", "kind", "category", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "calculator_definitions_business_id_key_key" ON "calculator_definitions"("business_id", "key");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculator_definitions" ADD CONSTRAINT "calculator_definitions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 10: row-level security and data rules ====================
-- Invoices, invoice lines, payments and processor events; content editor items; calculators.

-- ---------- Grants ----------
-- Invoices, payments and processor events are financial records: never deleted.
GRANT SELECT, INSERT, UPDATE ON invoices, payments, payment_events TO firmivra_app;
-- Lines are deleted only while the invoice is a draft (trigger below).
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_lines, content_items, calculator_definitions TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines          FORCE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events         FORCE ROW LEVEL SECURITY;
ALTER TABLE content_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items          FORCE ROW LEVEL SECURITY;
ALTER TABLE calculator_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_definitions FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
-- The webhook finds the firm from the event's connected account (`event.account`, looked up in
-- stripe_accounts in platform scope) before it opens that firm's business scope.
CREATE POLICY invoices_business ON invoices
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY invoice_lines_business ON invoice_lines
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY payments_business ON payments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY payment_events_business ON payment_events
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY content_items_business ON content_items
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY calculator_definitions_business ON calculator_definitions
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE invoices ADD CONSTRAINT invoices_number_not_blank CHECK (btrim(number) <> '');
ALTER TABLE invoices ADD CONSTRAINT invoices_currency CHECK (currency ~ '^[a-z]{3}$');
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts
  CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND total_cents >= 0
         AND total_cents = subtotal_cents - discount_cents);
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_at CHECK ((status = 'PAID') = (paid_at IS NOT NULL));
ALTER TABLE invoices ADD CONSTRAINT invoices_canceled_at
  CHECK ((status = 'CANCELED') = (canceled_at IS NOT NULL));
ALTER TABLE invoices ADD CONSTRAINT invoices_issued_at
  CHECK (status NOT IN ('OPEN', 'PAID') OR issued_at IS NOT NULL);
ALTER TABLE invoices ADD CONSTRAINT invoices_scheduled_for
  CHECK (status <> 'SCHEDULED' OR scheduled_for IS NOT NULL);

ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_values
  CHECK (btrim(description) <> '' AND quantity > 0 AND unit_amount_cents >= 0);

ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_cents > 0);
ALTER TABLE payments ADD CONSTRAINT payments_currency CHECK (currency ~ '^[a-z]{3}$');
ALTER TABLE payments ADD CONSTRAINT payments_processor_ref_not_blank CHECK (btrim(processor_ref) <> '');
ALTER TABLE payments ADD CONSTRAINT payments_paid_at
  CHECK ((status IN ('SUCCEEDED', 'REFUNDED')) = (paid_at IS NOT NULL));
ALTER TABLE payments ADD CONSTRAINT payments_refunded_at
  CHECK ((status = 'REFUNDED') = (refunded_at IS NOT NULL));

ALTER TABLE payment_events ADD CONSTRAINT payment_events_type_key
  CHECK (type ~ '^[a-z_]+(\.[a-z_]+)+$');
ALTER TABLE payment_events ADD CONSTRAINT payment_events_event_id_not_blank
  CHECK (btrim(processor_event_id) <> '');

ALTER TABLE content_items ADD CONSTRAINT content_items_title_not_blank CHECK (btrim(title) <> '');
-- An external link is an https URL; a resource or tip has a body.
ALTER TABLE content_items ADD CONSTRAINT content_items_link_or_body
  CHECK ((kind = 'EXTERNAL_LINK') = (url IS NOT NULL)
         AND (kind = 'EXTERNAL_LINK' OR body IS NOT NULL));
ALTER TABLE content_items ADD CONSTRAINT content_items_https_url CHECK (url ~ '^https://[^[:space:]]+$');

ALTER TABLE calculator_definitions ADD CONSTRAINT calculator_definitions_key
  CHECK (key ~ '^[a-z][a-z_]*$');
ALTER TABLE calculator_definitions ADD CONSTRAINT calculator_definitions_text
  CHECK (btrim(title) <> '' AND btrim(disclaimer) <> '');
ALTER TABLE calculator_definitions ADD CONSTRAINT calculator_definitions_config_object
  CHECK (jsonb_typeof(config) = 'object');

-- ---------- Invoices: totals kept by the database; status rules; PAID only when paid ----------
CREATE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.subtotal_cents <> 0 OR NEW.issued_at IS NOT NULL
       OR NEW.paid_at IS NOT NULL OR NEW.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoices: a new invoice starts as an empty DRAFT; add lines, then issue it'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'invoices: the client of an invoice cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('PAID', 'CANCELED')
     AND (NEW.status <> OLD.status OR NEW.subtotal_cents <> OLD.subtotal_cents
          OR NEW.discount_cents <> OLD.discount_cents OR NEW.number <> OLD.number
          OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
          OR NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
          OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
          OR NEW.canceled_at IS DISTINCT FROM OLD.canceled_at) THEN
    RAISE EXCEPTION 'invoices: a paid or canceled invoice is final'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only the invoice_lines trigger (one level down) moves the subtotal.
  IF NEW.subtotal_cents <> OLD.subtotal_cents AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'invoices: the subtotal is kept by the database from the lines'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.number <> OLD.number OR NEW.currency <> OLD.currency
          OR NEW.discount_cents <> OLD.discount_cents
          OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id) THEN
    RAISE EXCEPTION 'invoices: an issued invoice keeps its number, client, engagement and amounts'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'OPEN' AND NEW.status IN ('PAID', 'CANCELED'))) THEN
      RAISE EXCEPTION 'invoices: an invoice cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PAID' THEN
      SELECT coalesce(sum(p.amount_cents), 0) INTO paid_cents
        FROM payments p WHERE p.invoice_id = NEW.id AND p.status = 'SUCCEEDED';
      IF paid_cents < NEW.subtotal_cents - NEW.discount_cents THEN
        RAISE EXCEPTION 'invoices: PAID needs succeeded payments covering the total'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoices_rules
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_rules();

-- ---------- Invoice lines: only on a draft or scheduled invoice; amounts kept by the database ----------
CREATE FUNCTION invoice_lines_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.invoice_id <> OLD.invoice_id OR NEW.business_id <> OLD.business_id) THEN
    RAISE EXCEPTION 'invoice lines: a line stays on its invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices i
                 WHERE i.id = target AND i.status IN ('DRAFT', 'SCHEDULED')) THEN
    RAISE EXCEPTION 'invoice lines: lines change only while the invoice is a draft or scheduled'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.amount_cents := round(NEW.quantity * NEW.unit_amount_cents);
  RETURN NEW;
END
$$;

CREATE TRIGGER invoice_lines_rules
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_rules();

CREATE FUNCTION invoice_lines_total() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  UPDATE invoices
     SET subtotal_cents = (SELECT coalesce(sum(l.amount_cents), 0)
                             FROM invoice_lines l WHERE l.invoice_id = target)
   WHERE id = target;
  RETURN NULL;
END
$$;

CREATE TRIGGER invoice_lines_total
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_total();

-- ---------- Payments: start PENDING on an OPEN invoice; money confirmed only by an event ----------
CREATE FUNCTION payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.paid_at IS NOT NULL OR NEW.refunded_at IS NOT NULL THEN
      RAISE EXCEPTION 'payments: a payment starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices i
                   WHERE i.id = NEW.invoice_id AND i.status = 'OPEN' AND i.currency = NEW.currency) THEN
      RAISE EXCEPTION 'payments: only an open invoice can be paid, in its own currency'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.invoice_id <> OLD.invoice_id
     OR NEW.amount_cents <> OLD.amount_cents OR NEW.currency <> OLD.currency
     OR NEW.processor <> OLD.processor OR NEW.processor_ref <> OLD.processor_ref
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'payments: the invoice, amount and processor reference cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
         OR (OLD.status = 'SUCCEEDED' AND NEW.status = 'REFUNDED')) THEN
      RAISE EXCEPTION 'payments: a payment cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Money moves only on a recorded (verified) processor event about this payment.
    IF NEW.status IN ('SUCCEEDED', 'REFUNDED')
       AND NOT EXISTS (SELECT 1 FROM payment_events e WHERE e.payment_id = NEW.id) THEN
      RAISE EXCEPTION 'payments: % needs a recorded processor event for this payment', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payments_rules
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_rules();

-- ---------- Processor events: recorded once; then only linked and marked processed, once ----------
CREATE FUNCTION payment_events_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.processor <> OLD.processor
     OR NEW.processor_event_id <> OLD.processor_event_id OR NEW.type <> OLD.type
     OR NEW.received_at <> OLD.received_at
     OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
     OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
    RAISE EXCEPTION 'payment events: an event is recorded once; only its payment and processed time are set, once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payment_events_rules
  BEFORE UPDATE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION payment_events_rules();
