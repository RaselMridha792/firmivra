-- R37 (Rasel, Oct 14), Clients: tags and county. The firm's tags (a catalog the owner and admins
-- keep) and the tags on each client; the profile's county; the indexes the list's state and
-- client-type filters need. Email and SMS consent are not stored here: they are the client's rows
-- in communication_consents (R39). Leads reuse the tags in a later migration.

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "county" TEXT;

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tags" (
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tags_pkey" PRIMARY KEY ("client_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_business_id_id_key" ON "tags"("business_id", "id");

-- CreateIndex
CREATE INDEX "client_tags_business_id_tag_id_idx" ON "client_tags"("business_id", "tag_id");

-- CreateIndex
CREATE INDEX "client_profiles_business_id_state_idx" ON "client_profiles"("business_id", "state");

-- CreateIndex
CREATE INDEX "client_profiles_business_id_entity_type_idx" ON "client_profiles"("business_id", "entity_type");

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_business_id_tag_id_fkey" FOREIGN KEY ("business_id", "tag_id") REFERENCES "tags"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_business_id_added_by_user_id_fkey" FOREIGN KEY ("business_id", "added_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Tags are archived, never deleted; taking a tag off a client deletes its row.
GRANT SELECT, INSERT, UPDATE ON tags TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON client_tags TO firmivra_app;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
ALTER TABLE client_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tags_business ON tags
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY client_tags_business ON client_tags
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE tags ADD CONSTRAINT tags_name
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 50 AND app_no_hidden_characters(name));
CREATE UNIQUE INDEX tags_live_name ON tags (business_id, lower(btrim(name))) WHERE archived_at IS NULL;
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_county
  CHECK (county IS NULL OR (char_length(btrim(county)) >= 1 AND char_length(county) <= 100
         AND app_no_hidden_characters(county)));

-- ---------- Rules ----------
-- A tag stays with its firm and is archived once, for good; an archived tag is not applied.
CREATE FUNCTION tags_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.created_at <> OLD.created_at
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'tags: the firm and maker of a tag cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'tags: an archived tag stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tags_rules BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION tags_rules();

CREATE FUNCTION client_tags_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tags t WHERE t.business_id = NEW.business_id AND t.id = NEW.tag_id
             AND t.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'client tags: an archived tag cannot be applied'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_tags_rules BEFORE INSERT ON client_tags
  FOR EACH ROW EXECUTE FUNCTION client_tags_rules();
