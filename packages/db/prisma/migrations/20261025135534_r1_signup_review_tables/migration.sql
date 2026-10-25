-- r1_signup_review_tables (R1, Oct 25; Rasel's tap of Oct 25 12:48 UTC, R55's "Client Sign-ups" request in
-- docs/work/R55-oct25-review.md, with Rasel's answers): match candidates, call
-- verifications (append-only) and operations (idempotency, at most one invite or recovery per
-- sign-up). Firm-scoped with forced RLS; the app role never deletes. Audit stays in audit_logs.


-- CreateTable
CREATE TABLE "client_signup_match_candidates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "candidate_client_id" UUID NOT NULL,
    "matched_on" TEXT[],
    "resolution" "SignupCandidateResolution" NOT NULL DEFAULT 'OPEN',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_signup_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_signup_verifications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "candidate_client_id" UUID NOT NULL,
    "contact_ref" "SignupContactRef" NOT NULL,
    "call_outcome" "SignupCallOutcome" NOT NULL,
    "identity_result" "SignupIdentityResult" NOT NULL,
    "permission_scope" "SignupPermissionScope",
    "permission_recorded_at" TIMESTAMPTZ(3),
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_signup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_signup_operations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_account_id" UUID,
    "kind" "SignupOperationKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "SignupOperationStatus" NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "correlation_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_signup_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_signup_match_candidates_business_id_candidate_client_idx" ON "client_signup_match_candidates"("business_id", "candidate_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_signup_match_candidates_business_id_client_account_i_key" ON "client_signup_match_candidates"("business_id", "client_account_id", "candidate_client_id");

-- CreateIndex
CREATE INDEX "client_signup_verifications_business_id_client_account_id_c_idx" ON "client_signup_verifications"("business_id", "client_account_id", "created_at");

-- CreateIndex
CREATE INDEX "client_signup_operations_business_id_client_account_id_idx" ON "client_signup_operations"("business_id", "client_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_signup_operations_business_id_idempotency_key_key" ON "client_signup_operations"("business_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "client_signup_match_candidates" ADD CONSTRAINT "client_signup_match_candidates_business_id_client_account__fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_match_candidates" ADD CONSTRAINT "client_signup_match_candidates_business_id_candidate_clien_fkey" FOREIGN KEY ("business_id", "candidate_client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_match_candidates" ADD CONSTRAINT "client_signup_match_candidates_business_id_reviewed_by_use_fkey" FOREIGN KEY ("business_id", "reviewed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_verifications" ADD CONSTRAINT "client_signup_verifications_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_verifications" ADD CONSTRAINT "client_signup_verifications_business_id_candidate_client_i_fkey" FOREIGN KEY ("business_id", "candidate_client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_verifications" ADD CONSTRAINT "client_signup_verifications_business_id_actor_user_id_fkey" FOREIGN KEY ("business_id", "actor_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_operations" ADD CONSTRAINT "client_signup_operations_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_signup_operations" ADD CONSTRAINT "client_signup_operations_business_id_actor_user_id_fkey" FOREIGN KEY ("business_id", "actor_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An invite or recovery is dispatched at most once per sign-up.
CREATE UNIQUE INDEX client_signup_operations_one_delivery
  ON client_signup_operations (business_id, client_account_id, kind)
  WHERE kind IN ('INVITE_DELIVERY', 'RECOVERY_DELIVERY');


-- ---------- Grants, RLS ----------
-- Candidates and operations change (a review, a delivery's attempts); verifications are a record:
-- SELECT and INSERT only. Nothing here is ever deleted by the app.
GRANT SELECT, INSERT, UPDATE ON client_signup_match_candidates TO firmivra_app;
GRANT SELECT, INSERT ON client_signup_verifications TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON client_signup_operations TO firmivra_app;

ALTER TABLE client_signup_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_signup_match_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY client_signup_match_candidates_business ON client_signup_match_candidates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE client_signup_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_signup_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY client_signup_verifications_business ON client_signup_verifications
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE client_signup_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_signup_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY client_signup_operations_business ON client_signup_operations
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- Field names only (email, phone, name_and_birth_date, ...), never values.
ALTER TABLE client_signup_match_candidates ADD CONSTRAINT client_signup_match_candidates_matched_on
  CHECK (cardinality(matched_on) >= 1 AND array_position(matched_on, NULL) IS NULL
         AND array_to_string(matched_on, ',') ~ '^[a-z_]+(,[a-z_]+)*$');
ALTER TABLE client_signup_match_candidates ADD CONSTRAINT client_signup_match_candidates_rationale
  CHECK (rationale IS NULL OR char_length(rationale) <= 500);
-- A candidate that is no longer OPEN says who reviewed it and when.
ALTER TABLE client_signup_match_candidates ADD CONSTRAINT client_signup_match_candidates_reviewed
  CHECK (resolution = 'OPEN' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL));

ALTER TABLE client_signup_verifications ADD CONSTRAINT client_signup_verifications_permission
  CHECK ((permission_scope IS NULL) = (permission_recorded_at IS NULL));

-- Only a POLICY_CHANGE belongs to no sign-up; every other kind names one.
ALTER TABLE client_signup_operations ADD CONSTRAINT client_signup_operations_account
  CHECK ((client_account_id IS NULL) = (kind = 'POLICY_CHANGE'));
ALTER TABLE client_signup_operations ADD CONSTRAINT client_signup_operations_request_hash_sha256
  CHECK (request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE client_signup_operations ADD CONSTRAINT client_signup_operations_attempts_not_negative
  CHECK (attempts >= 0);

-- An operation keeps its kind, key, payload hash and sign-up: a retry changes only its state.
CREATE FUNCTION client_signup_operations_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.kind <> OLD.kind
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_hash <> OLD.request_hash
     OR NEW.client_account_id IS DISTINCT FROM OLD.client_account_id THEN
    RAISE EXCEPTION 'client sign-up operations: kind, key, request hash and sign-up never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER client_signup_operations_rules
  BEFORE UPDATE ON client_signup_operations
  FOR EACH ROW EXECUTE FUNCTION client_signup_operations_rules();
