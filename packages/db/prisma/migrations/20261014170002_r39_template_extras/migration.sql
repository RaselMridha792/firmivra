-- CreateTable
CREATE TABLE "message_template_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template_shares" (
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_shares_pkey" PRIMARY KEY ("template_id","user_id")
);

-- CreateTable
CREATE TABLE "message_template_favorites" (
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_favorites_pkey" PRIMARY KEY ("template_id","user_id")
);

-- CreateTable
CREATE TABLE "message_template_uses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "used_by_user_id" UUID,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_branding" (
    "business_id" UUID NOT NULL,
    "footer_text" TEXT,
    "disclaimer" TEXT,
    "signature_text" TEXT,
    "letterhead_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "template_branding_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "custom_merge_fields" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fallback" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_merge_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_template_attachments_s3_key_key" ON "message_template_attachments"("s3_key");

-- CreateIndex
CREATE INDEX "message_template_attachments_business_id_template_id_idx" ON "message_template_attachments"("business_id", "template_id");

-- CreateIndex
CREATE INDEX "message_template_shares_business_id_user_id_idx" ON "message_template_shares"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "message_template_favorites_business_id_user_id_idx" ON "message_template_favorites"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "message_template_uses_business_id_template_id_used_at_idx" ON "message_template_uses"("business_id", "template_id", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_merge_fields_business_id_key_key" ON "custom_merge_fields"("business_id", "key");

-- AddForeignKey
ALTER TABLE "message_template_attachments" ADD CONSTRAINT "message_template_attachments_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_shares" ADD CONSTRAINT "message_template_shares_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_favorites" ADD CONSTRAINT "message_template_favorites_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_uses" ADD CONSTRAINT "message_template_uses_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: the use log is insert-only; the rest follows what the screens do.
GRANT SELECT, INSERT, DELETE ON message_template_shares, message_template_favorites,
  message_template_attachments TO firmivra_app;
GRANT SELECT, INSERT ON message_template_uses TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON template_branding TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_merge_fields TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_template_shares', 'message_template_favorites', 'message_template_attachments', 'message_template_uses', 'template_branding', 'custom_merge_fields'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE message_template_attachments ADD CONSTRAINT message_template_attachments_values
  CHECK (esign_text_ok(file_name, 255) AND size_bytes BETWEEN 1 AND 10485760
         AND content_type IN ('application/pdf', 'image/jpeg', 'image/png',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
         AND starts_with(s3_key, 'tenant/' || business_id || '/templates/')
         AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)');

ALTER TABLE message_template_uses ADD CONSTRAINT message_template_uses_values
  CHECK (version >= 1 AND purpose ~ '^[a-z][a-z0-9_.]{0,59}$'
         AND (entity_type IS NULL OR entity_type ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (entity_type IS NULL) = (entity_id IS NULL));

ALTER TABLE template_branding ADD CONSTRAINT template_branding_values
  CHECK ((footer_text IS NULL OR esign_text_ok(footer_text, 1000))
         AND (disclaimer IS NULL OR esign_text_ok(disclaimer, 2000))
         AND (signature_text IS NULL OR esign_text_ok(signature_text, 1000)));

-- A merge field key is what sits between the brackets: letters, digits and single spaces.
ALTER TABLE custom_merge_fields ADD CONSTRAINT custom_merge_fields_values
  CHECK (key ~ '^[A-Za-z][A-Za-z0-9]*( [A-Za-z0-9]+)*$' AND char_length(key) <= 40
         AND esign_text_ok(label, 100) AND (fallback IS NULL OR esign_text_ok(fallback, 200)));

-- A template is shared only with people who work at the firm.
CREATE FUNCTION message_template_shares_member() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.business_id = NEW.business_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'TEMPLATE_SHARE_MEMBER: the person is not a member of this firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER message_template_shares_member BEFORE INSERT ON message_template_shares
  FOR EACH ROW EXECUTE FUNCTION message_template_shares_member();
