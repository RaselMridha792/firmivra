-- r0_esign (R13-api drafts for R0; issue #156, Rasel's approval Oct 10): Firm Sign's tables,
-- the scan exception for its filed copies, and the module switch. Firm Sign is behind the module
-- `esign`: business_settings.enabled_modules now changes only through app_set_business_module
-- (the migrate role), and holds only 'esign' and 'calculators'. Every new table is a firm table:
-- business_id, same-firm foreign keys, RLS enabled and forced with the business policy, and only
-- the grants the API's repository ports need (apps/api/src/esign/*/*.repository.ts).

-- CreateEnum
CREATE TYPE "EsignRequestStatus" AS ENUM ('DRAFT', 'NEEDS_APPROVAL', 'SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EsignSource" AS ENUM ('TAB', 'CLIENT_RECORD', 'TEMPLATE', 'BULK');

-- CreateEnum
CREATE TYPE "EsignRouting" AS ENUM ('SEQUENTIAL', 'PARALLEL');

-- CreateEnum
CREATE TYPE "EsignRecipientKind" AS ENUM ('SIGNER', 'APPROVER', 'CC');

-- CreateEnum
CREATE TYPE "EsignRecipientRole" AS ENUM ('CLIENT', 'SPOUSE', 'BUSINESS_OWNER', 'EMPLOYEE', 'PREPARER', 'MANAGER', 'WITNESS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EsignRecipientStatus" AS ENUM ('WAITING', 'SENT', 'DELIVERED', 'VIEWED', 'SIGNED', 'APPROVED', 'REJECTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "EsignDelivery" AS ENUM ('EMAIL', 'PORTAL', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "EsignAuthMethod" AS ENUM ('LINK', 'EMAIL_CODE', 'ACCESS_CODE', 'PORTAL_SESSION', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "EsignFieldType" AS ENUM ('SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'PRINTED_NAME', 'EMAIL', 'PHONE', 'ADDRESS', 'TEXT', 'CHECKBOX', 'RADIO', 'DROPDOWN', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "EsignEventType" AS ENUM ('CREATED', 'EDITED', 'APPROVAL_REQUESTED', 'APPROVED', 'APPROVAL_REJECTED', 'SENT', 'DELIVERED', 'VIEWED', 'AUTH_PASSED', 'AUTH_FAILED', 'CONSENTED', 'SIGNED', 'REMINDER_SENT', 'EXPIRY_WARNING_SENT', 'DECLINED', 'EXPIRED', 'VOIDED', 'CORRECTED', 'REPLACED', 'COMPLETED', 'COPY_SENT', 'DOWNLOADED', 'IN_PERSON_STARTED', 'IN_PERSON_ENDED');

-- CreateEnum
CREATE TYPE "EsignActorKind" AS ENUM ('STAFF', 'SIGNER', 'CLIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EsignTemplateVisibility" AS ENUM ('FIRM', 'PRIVATE');

-- CreateEnum
CREATE TYPE "EsignBulkItemState" AS ENUM ('QUEUED', 'SENT', 'NOT_SENT');

-- CreateEnum
CREATE TYPE "EsignRecipientLinkType" AS ENUM ('CLIENT_LOGIN', 'STAFF', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "EsignLinkPurpose" AS ENUM ('SIGN', 'COPY', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "EsignCodeKind" AS ENUM ('EMAIL', 'ACCESS');

-- CreateEnum
CREATE TYPE "EsignStaffRole" AS ENUM ('MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "EsignApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "EsignEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EsignUploadKind" AS ENUM ('DOCUMENT', 'ATTACHMENT');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "esign_request_id" UUID;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "job_title" TEXT;

-- CreateTable
CREATE TABLE "esign_settings" (
    "business_id" UUID NOT NULL,
    "expiry_days" INTEGER NOT NULL DEFAULT 30,
    "reminder_first_after_days" INTEGER NOT NULL DEFAULT 3,
    "reminder_every_days" INTEGER NOT NULL DEFAULT 3,
    "reminder_max" INTEGER NOT NULL DEFAULT 3,
    "expiry_warning_days" INTEGER NOT NULL DEFAULT 2,
    "auth_method" "EsignAuthMethod" NOT NULL DEFAULT 'EMAIL_CODE',
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "email_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "esign_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "esign_consent_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_user_id" UUID,

    CONSTRAINT "esign_consent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_member_roles" (
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "EsignStaffRole" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "esign_member_roles_pkey" PRIMARY KEY ("business_id","user_id")
);

-- CreateTable
CREATE TABLE "esign_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "EsignTemplateVisibility" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "esign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_template_versions" (
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_sizes" JSONB NOT NULL,
    "roles" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "routing" "EsignRouting" NOT NULL,
    "expiry_days" INTEGER NOT NULL,
    "reminder_first_after_days" INTEGER NOT NULL,
    "reminder_every_days" INTEGER NOT NULL,
    "reminder_max" INTEGER NOT NULL,
    "expiry_warning_days" INTEGER NOT NULL,
    "email_subject" TEXT,
    "email_message" TEXT,
    "note" TEXT,
    "saved_by_user_id" UUID NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_template_versions_pkey" PRIMARY KEY ("template_id","version")
);

-- CreateTable
CREATE TABLE "esign_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EsignRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "EsignSource" NOT NULL,
    "client_id" UUID,
    "engagement_id" UUID,
    "sender_user_id" UUID NOT NULL,
    "internal_note" TEXT,
    "email_subject" TEXT,
    "email_message" TEXT,
    "routing" "EsignRouting" NOT NULL,
    "expiry_days" INTEGER NOT NULL,
    "reminder_first_after_days" INTEGER NOT NULL,
    "reminder_every_days" INTEGER NOT NULL,
    "reminder_max" INTEGER NOT NULL,
    "expiry_warning_days" INTEGER NOT NULL,
    "page_plan" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "completion_due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "original_sha256" TEXT,
    "final_sha256" TEXT,
    "certificate_sha256" TEXT,
    "final_document_id" UUID,
    "certificate_document_id" UUID,
    "expired_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "voided_by_user_id" UUID,
    "replaces_request_id" UUID,
    "replaced_by_request_id" UUID,
    "expiry_warned_at" TIMESTAMPTZ(3),
    "template_id" UUID,
    "template_version" INTEGER,

    CONSTRAINT "esign_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL,
    "page_sizes" JSONB NOT NULL,
    "source_document_id" UUID,
    "s3_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_recipients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "EsignRecipientKind" NOT NULL,
    "role" "EsignRecipientRole" NOT NULL,
    "role_label" TEXT,
    "routing_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "link_type" "EsignRecipientLinkType" NOT NULL,
    "client_account_id" UUID,
    "staff_user_id" UUID,
    "delivery" "EsignDelivery" NOT NULL,
    "auth_method" "EsignAuthMethod" NOT NULL,
    "access_code_hash" TEXT,
    "color_index" INTEGER NOT NULL,
    "status" "EsignRecipientStatus" NOT NULL DEFAULT 'WAITING',
    "sent_at" TIMESTAMPTZ(3),
    "viewed_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "last_reminded_at" TIMESTAMPTZ(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "consent_version_id" UUID,
    "consented_at" TIMESTAMPTZ(3),
    "printed_name" TEXT,
    "signature_method" "SignatureMethod",
    "signature_text" TEXT,
    "signature_png" BYTEA,
    "initials_method" "SignatureMethod",
    "initials_text" TEXT,
    "initials_png" BYTEA,
    "adopted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_verification_codes" (
    "business_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "kind" "EsignCodeKind" NOT NULL,
    "code_hash" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "tries" INTEGER NOT NULL DEFAULT 0,
    "sent_times" TIMESTAMPTZ(3)[] DEFAULT ARRAY[]::TIMESTAMPTZ(3)[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "esign_verification_codes_pkey" PRIMARY KEY ("recipient_id","kind")
);

-- CreateTable
CREATE TABLE "esign_fields" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID,
    "position" INTEGER NOT NULL,
    "type" "EsignFieldType" NOT NULL,
    "page_index" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL,
    "label" TEXT,
    "merge_key" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "group_key" TEXT,
    "value_enc" BYTEA,
    "filled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "esign_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "type" "EsignEventType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" "EsignActorKind" NOT NULL,
    "actor_user_id" UUID,
    "actor_name" TEXT NOT NULL,
    "recipient_id" UUID,
    "recipient_name" TEXT,
    "reason" TEXT,
    "auth_method" "EsignAuthMethod",
    "ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "esign_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_approval_notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "decision" "EsignApprovalDecision" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_approval_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_emails" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID,
    "user_id" UUID,
    "template" TEXT NOT NULL,
    "status" "EsignEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "esign_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_signing_links" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "token_version" INTEGER NOT NULL,
    "purpose" "EsignLinkPurpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_signing_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_pending_uploads" (
    "business_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" "EsignUploadKind" NOT NULL,
    "request_id" UUID NOT NULL,
    "user_id" UUID,
    "recipient_id" UUID,
    "field_id" UUID,
    "file_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_pending_uploads_pkey" PRIMARY KEY ("business_id","token_hash")
);

-- CreateTable
CREATE TABLE "esign_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esign_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_kiosk_locks" (
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "signer_name" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "link_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "active_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wrong_passwords" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "esign_kiosk_locks_pkey" PRIMARY KEY ("business_id","user_id")
);

-- CreateTable
CREATE TABLE "esign_bulk_batches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "template_name" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "roles" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "esign_bulk_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esign_bulk_items" (
    "business_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "request_id" UUID NOT NULL,
    "created" BOOLEAN NOT NULL DEFAULT false,
    "state" "EsignBulkItemState" NOT NULL DEFAULT 'QUEUED',
    "problem" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "esign_bulk_items_pkey" PRIMARY KEY ("batch_id","position")
);

-- CreateIndex
CREATE UNIQUE INDEX "esign_consent_versions_business_id_version_key" ON "esign_consent_versions"("business_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "esign_consent_versions_business_id_id_key" ON "esign_consent_versions"("business_id", "id");

-- CreateIndex
CREATE INDEX "esign_templates_business_id_updated_at_idx" ON "esign_templates"("business_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "esign_templates_business_id_id_key" ON "esign_templates"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_template_versions_s3_key_key" ON "esign_template_versions"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "esign_template_versions_business_id_template_id_version_key" ON "esign_template_versions"("business_id", "template_id", "version");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_status_last_activity_at_idx" ON "esign_requests"("business_id", "status", "last_activity_at");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_status_expires_at_idx" ON "esign_requests"("business_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_completion_due_at_idx" ON "esign_requests"("business_id", "completion_due_at");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_sent_at_idx" ON "esign_requests"("business_id", "sent_at");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_client_id_idx" ON "esign_requests"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "esign_requests_business_id_sender_user_id_idx" ON "esign_requests"("business_id", "sender_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_requests_business_id_id_key" ON "esign_requests"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_requests_business_id_replaces_request_id_key" ON "esign_requests"("business_id", "replaces_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_requests_business_id_replaced_by_request_id_key" ON "esign_requests"("business_id", "replaced_by_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_requests_business_id_final_document_id_key" ON "esign_requests"("business_id", "final_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_requests_business_id_certificate_document_id_key" ON "esign_requests"("business_id", "certificate_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_documents_s3_key_key" ON "esign_documents"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "esign_documents_business_id_id_key" ON "esign_documents"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_documents_business_id_request_id_position_key" ON "esign_documents"("business_id", "request_id", "position");

-- CreateIndex
CREATE INDEX "esign_recipients_business_id_request_id_idx" ON "esign_recipients"("business_id", "request_id");

-- CreateIndex
CREATE INDEX "esign_recipients_business_id_client_account_id_idx" ON "esign_recipients"("business_id", "client_account_id");

-- CreateIndex
CREATE INDEX "esign_recipients_business_id_staff_user_id_idx" ON "esign_recipients"("business_id", "staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_recipients_business_id_id_key" ON "esign_recipients"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_recipients_business_id_request_id_id_key" ON "esign_recipients"("business_id", "request_id", "id");

-- CreateIndex
CREATE INDEX "esign_verification_codes_business_id_idx" ON "esign_verification_codes"("business_id");

-- CreateIndex
CREATE INDEX "esign_fields_business_id_request_id_idx" ON "esign_fields"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_fields_business_id_id_key" ON "esign_fields"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_fields_business_id_request_id_id_key" ON "esign_fields"("business_id", "request_id", "id");

-- CreateIndex
CREATE INDEX "esign_events_business_id_request_id_created_at_idx" ON "esign_events"("business_id", "request_id", "created_at");

-- CreateIndex
CREATE INDEX "esign_approval_notes_business_id_request_id_created_at_idx" ON "esign_approval_notes"("business_id", "request_id", "created_at");

-- CreateIndex
CREATE INDEX "esign_emails_business_id_status_created_at_idx" ON "esign_emails"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "esign_emails_business_id_request_id_idx" ON "esign_emails"("business_id", "request_id");

-- CreateIndex
CREATE INDEX "esign_signing_links_business_id_recipient_id_idx" ON "esign_signing_links"("business_id", "recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_signing_links_business_id_token_hash_key" ON "esign_signing_links"("business_id", "token_hash");

-- CreateIndex
CREATE INDEX "esign_pending_uploads_business_id_created_at_idx" ON "esign_pending_uploads"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "esign_attachments_s3_key_key" ON "esign_attachments"("s3_key");

-- CreateIndex
CREATE INDEX "esign_attachments_business_id_request_id_idx" ON "esign_attachments"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_attachments_business_id_recipient_id_field_id_key" ON "esign_attachments"("business_id", "recipient_id", "field_id");

-- CreateIndex
CREATE INDEX "esign_bulk_batches_business_id_created_at_idx" ON "esign_bulk_batches"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "esign_bulk_batches_business_id_id_key" ON "esign_bulk_batches"("business_id", "id");

-- CreateIndex
CREATE INDEX "esign_bulk_items_business_id_state_idx" ON "esign_bulk_items"("business_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "esign_bulk_items_business_id_request_id_key" ON "esign_bulk_items"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "esign_bulk_items_batch_id_client_id_key" ON "esign_bulk_items"("batch_id", "client_id");

-- CreateIndex
CREATE INDEX "documents_business_id_esign_request_id_idx" ON "documents"("business_id", "esign_request_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_esign_request_id_fkey" FOREIGN KEY ("business_id", "esign_request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_settings" ADD CONSTRAINT "esign_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_consent_versions" ADD CONSTRAINT "esign_consent_versions_business_id_published_by_user_id_fkey" FOREIGN KEY ("business_id", "published_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_member_roles" ADD CONSTRAINT "esign_member_roles_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_templates" ADD CONSTRAINT "esign_templates_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_template_versions" ADD CONSTRAINT "esign_template_versions_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "esign_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_template_versions" ADD CONSTRAINT "esign_template_versions_business_id_saved_by_user_id_fkey" FOREIGN KEY ("business_id", "saved_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_sender_user_id_fkey" FOREIGN KEY ("business_id", "sender_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_voided_by_user_id_fkey" FOREIGN KEY ("business_id", "voided_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_replaces_request_id_fkey" FOREIGN KEY ("business_id", "replaces_request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_replaced_by_request_id_fkey" FOREIGN KEY ("business_id", "replaced_by_request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_final_document_id_fkey" FOREIGN KEY ("business_id", "final_document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_certificate_document_id_fkey" FOREIGN KEY ("business_id", "certificate_document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "esign_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_requests" ADD CONSTRAINT "esign_requests_business_id_template_id_template_version_fkey" FOREIGN KEY ("business_id", "template_id", "template_version") REFERENCES "esign_template_versions"("business_id", "template_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_documents" ADD CONSTRAINT "esign_documents_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_recipients" ADD CONSTRAINT "esign_recipients_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_recipients" ADD CONSTRAINT "esign_recipients_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_recipients" ADD CONSTRAINT "esign_recipients_business_id_staff_user_id_fkey" FOREIGN KEY ("business_id", "staff_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_recipients" ADD CONSTRAINT "esign_recipients_business_id_consent_version_id_fkey" FOREIGN KEY ("business_id", "consent_version_id") REFERENCES "esign_consent_versions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_verification_codes" ADD CONSTRAINT "esign_verification_codes_business_id_recipient_id_fkey" FOREIGN KEY ("business_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_approval_notes" ADD CONSTRAINT "esign_approval_notes_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_approval_notes" ADD CONSTRAINT "esign_approval_notes_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_emails" ADD CONSTRAINT "esign_emails_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_emails" ADD CONSTRAINT "esign_emails_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_emails" ADD CONSTRAINT "esign_emails_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_signing_links" ADD CONSTRAINT "esign_signing_links_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_signing_links" ADD CONSTRAINT "esign_signing_links_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_pending_uploads" ADD CONSTRAINT "esign_pending_uploads_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_pending_uploads" ADD CONSTRAINT "esign_pending_uploads_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_pending_uploads" ADD CONSTRAINT "esign_pending_uploads_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_pending_uploads" ADD CONSTRAINT "esign_pending_uploads_business_id_request_id_field_id_fkey" FOREIGN KEY ("business_id", "request_id", "field_id") REFERENCES "esign_fields"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_attachments" ADD CONSTRAINT "esign_attachments_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_attachments" ADD CONSTRAINT "esign_attachments_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_attachments" ADD CONSTRAINT "esign_attachments_business_id_request_id_field_id_fkey" FOREIGN KEY ("business_id", "request_id", "field_id") REFERENCES "esign_fields"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_kiosk_locks" ADD CONSTRAINT "esign_kiosk_locks_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_kiosk_locks" ADD CONSTRAINT "esign_kiosk_locks_business_id_request_id_recipient_id_fkey" FOREIGN KEY ("business_id", "request_id", "recipient_id") REFERENCES "esign_recipients"("business_id", "request_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_bulk_batches" ADD CONSTRAINT "esign_bulk_batches_business_id_template_id_template_versio_fkey" FOREIGN KEY ("business_id", "template_id", "template_version") REFERENCES "esign_template_versions"("business_id", "template_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_bulk_batches" ADD CONSTRAINT "esign_bulk_batches_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_bulk_items" ADD CONSTRAINT "esign_bulk_items_business_id_batch_id_fkey" FOREIGN KEY ("business_id", "batch_id") REFERENCES "esign_bulk_batches"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_bulk_items" ADD CONSTRAINT "esign_bulk_items_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esign_bulk_items" ADD CONSTRAINT "esign_bulk_items_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Existing rows (local and dev), before the checks ----------
-- enabled_modules keeps only the known modules, once each, sorted; NULL becomes empty. Each firm
-- in its own scope (forced RLS).
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE business_settings
       SET enabled_modules = ARRAY(SELECT DISTINCT m FROM unnest(enabled_modules) AS u(m)
                                    WHERE m IN ('esign', 'calculators') ORDER BY m)
     WHERE business_id = firm;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- ---------- Grants: what the repository ports do, nothing more ----------
-- Insert-only: consent versions, template versions, events, approval notes, signing links and
-- bulk batches. Nothing that is a record of the signing is ever deleted; a DRAFT's parts go with
-- it (ON DELETE CASCADE).
GRANT SELECT, INSERT, UPDATE ON esign_settings, esign_templates, esign_emails, esign_bulk_items
  TO firmivra_app;
GRANT SELECT, INSERT ON esign_consent_versions, esign_template_versions, esign_events,
  esign_approval_notes, esign_signing_links, esign_bulk_batches TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON esign_member_roles, esign_requests, esign_documents,
  esign_recipients, esign_verification_codes, esign_fields, esign_attachments, esign_kiosk_locks
  TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON esign_pending_uploads TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['esign_settings', 'esign_consent_versions', 'esign_member_roles',
    'esign_templates', 'esign_template_versions', 'esign_requests', 'esign_documents',
    'esign_recipients', 'esign_verification_codes', 'esign_fields', 'esign_events',
    'esign_approval_notes', 'esign_emails', 'esign_signing_links', 'esign_pending_uploads',
    'esign_attachments', 'esign_kiosk_locks', 'esign_bulk_batches', 'esign_bulk_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF t <> 'esign_requests' THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                     ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
    END IF;
  END LOOP;
END
$$;

-- Requests: only a DRAFT is ever deleted (with its parts); a sent request is a record.
CREATE POLICY esign_requests_select ON esign_requests FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY esign_requests_insert ON esign_requests FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY esign_requests_update ON esign_requests FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY esign_requests_delete ON esign_requests FOR DELETE
  USING (business_id = app_current_business_id() AND status = 'DRAFT');

-- ---------- Shape ----------
-- Hex SHA-256 (and HMAC-SHA256) values.
CREATE FUNCTION esign_hex64(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v ~ '^[0-9a-f]{64}$' $$;
-- No NULL and nothing twice.
CREATE FUNCTION esign_distinct(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT count(DISTINCT i) = count(*) AND count(i) = count(*) FROM unnest(items) AS u(i) $$;
-- Text with something visible in it (not only blanks), up to `max` characters: tabs and \r\n
-- line breaks, no other control (C0, C1), line separator, filler or invisible characters (emoji
-- joiners and selectors stay), as intakes_correction (r0_intake_engine).
CREATE FUNCTION esign_text_ok(v text, max integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v ~ '[^[:space:]\xA0\u1680\u2000-\u200F\u202F\u205F\u2800\u3000\uFE00-\uFE0F]'
               AND char_length(v) <= max
               AND v !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xAD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E007F]' $$;
-- An S3 key under the firm's Firm Sign folder for `folder` (a request or a template), then `rest`.
CREATE FUNCTION esign_key_ok(k text, business uuid, folder uuid, rest text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT starts_with(k, 'tenant/' || business || '/esign/' || folder || '/' || rest)
               AND k ~ '^[A-Za-z0-9/._-]+$' AND k !~ '(^|/)\.\.?(/|$)' $$;

ALTER TABLE esign_settings ADD CONSTRAINT esign_settings_values
  CHECK (expiry_days BETWEEN 1 AND 365
         AND reminder_first_after_days BETWEEN 1 AND 60 AND reminder_every_days BETWEEN 1 AND 60
         AND reminder_max BETWEEN 0 AND 10 AND expiry_warning_days BETWEEN 0 AND 30
         AND auth_method IN ('LINK', 'EMAIL_CODE', 'ACCESS_CODE')
         AND esign_text_ok(email_message, 1000));

ALTER TABLE esign_consent_versions ADD CONSTRAINT esign_consent_versions_values
  CHECK (version >= 1 AND esign_text_ok(body_markdown, 20000)
         AND sha256 = encode(sha256(convert_to(body_markdown, 'UTF8')), 'hex'));

ALTER TABLE memberships ADD CONSTRAINT memberships_job_title CHECK (esign_text_ok(job_title, 100));

ALTER TABLE esign_templates ADD CONSTRAINT esign_templates_values
  CHECK (esign_text_ok(name, 200) AND esign_text_ok(description, 1000) AND version >= 1);
-- Active names are unique per firm, case-insensitively (SQL only: Prisma ignores it).
CREATE UNIQUE INDEX esign_templates_active_name ON esign_templates (business_id, lower(name))
  WHERE archived_at IS NULL;

ALTER TABLE esign_template_versions ADD CONSTRAINT esign_template_versions_values
  CHECK (version >= 1 AND esign_key_ok(s3_key, business_id, template_id, 'template-')
         AND esign_hex64(sha256) AND size_bytes BETWEEN 1 AND 10485760
         AND jsonb_typeof(page_sizes) = 'array'
         AND jsonb_array_length(page_sizes) BETWEEN 1 AND 100
         AND jsonb_typeof(roles) = 'array' AND jsonb_array_length(roles) <= 20
         AND jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 500
         AND expiry_days BETWEEN 1 AND 365
         AND reminder_first_after_days BETWEEN 1 AND 60 AND reminder_every_days BETWEEN 1 AND 60
         AND reminder_max BETWEEN 0 AND 10 AND expiry_warning_days BETWEEN 0 AND 30
         AND esign_text_ok(email_subject, 200) AND esign_text_ok(email_message, 1000)
         AND esign_text_ok(note, 500));

-- What a request holds at each status: the sending facts once sent; the closing facts exactly
-- with their status (a NEEDS_APPROVAL request can be voided unsent).
ALTER TABLE esign_requests ADD CONSTRAINT esign_requests_values
  CHECK (esign_text_ok(title, 200) AND esign_text_ok(internal_note, 2000)
         AND esign_text_ok(email_subject, 200) AND esign_text_ok(email_message, 1000)
         AND expiry_days BETWEEN 1 AND 365
         AND reminder_first_after_days BETWEEN 1 AND 60 AND reminder_every_days BETWEEN 1 AND 60
         AND reminder_max BETWEEN 0 AND 10 AND expiry_warning_days BETWEEN 0 AND 30
         AND jsonb_typeof(page_plan) = 'array' AND jsonb_array_length(page_plan) <= 100
         AND (engagement_id IS NULL OR client_id IS NOT NULL)
         AND (template_id IS NULL) = (template_version IS NULL)
         AND esign_hex64(original_sha256) AND esign_hex64(final_sha256)
         AND esign_hex64(certificate_sha256)
         AND esign_text_ok(void_reason, 500)
         AND replaces_request_id <> id AND replaced_by_request_id <> id);
ALTER TABLE esign_requests ADD CONSTRAINT esign_requests_status_facts
  CHECK ((status NOT IN ('DRAFT', 'NEEDS_APPROVAL')
            OR (sent_at IS NULL AND expires_at IS NULL AND original_sha256 IS NULL))
         AND (status IN ('DRAFT', 'NEEDS_APPROVAL', 'VOIDED')
            OR (sent_at IS NOT NULL AND expires_at IS NOT NULL AND original_sha256 IS NOT NULL))
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL)
         AND (status = 'COMPLETED') = (final_sha256 IS NOT NULL)
         AND (final_sha256 IS NULL) = (certificate_sha256 IS NULL)
         AND (final_document_id IS NULL) = (certificate_document_id IS NULL)
         AND (final_document_id IS NULL OR status = 'COMPLETED')
         AND (completion_due_at IS NULL OR status = 'PARTIALLY_SIGNED')
         AND (status = 'EXPIRED') = (expired_at IS NOT NULL)
         AND (status = 'VOIDED') = (voided_at IS NOT NULL)
         AND (voided_at IS NULL) = (void_reason IS NULL)
         AND (voided_at IS NULL) = (voided_by_user_id IS NULL)
         AND (replaced_by_request_id IS NULL OR status = 'VOIDED')
         AND (expiry_warned_at IS NULL OR sent_at IS NOT NULL));

ALTER TABLE esign_documents ADD CONSTRAINT esign_documents_values
  CHECK (position BETWEEN 0 AND 99 AND esign_text_ok(file_name, 255)
         AND content_type IN ('application/pdf', 'image/jpeg', 'image/png')
         AND size_bytes BETWEEN 1 AND 10485760 AND page_count BETWEEN 1 AND 100
         AND jsonb_typeof(page_sizes) = 'array' AND jsonb_array_length(page_sizes) = page_count
         AND esign_key_ok(s3_key, business_id, request_id, '') AND esign_hex64(sha256)
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

-- Who a recipient is matches its link; an approver is a staff member; the chosen check is never
-- PORTAL_SESSION or IN_PERSON (those are only recorded); each adopted mark is a text (TYPED) or a
-- PNG of at most 200 KB.
ALTER TABLE esign_recipients ADD CONSTRAINT esign_recipients_values
  CHECK (position BETWEEN 0 AND 19 AND routing_order BETWEEN 1 AND 20
         AND (role = 'CUSTOM') = (role_label IS NOT NULL) AND esign_text_ok(role_label, 100)
         AND esign_text_ok(name, 200) AND char_length(email) <= 254 AND char_length(phone) <= 40
         AND (link_type = 'CLIENT_LOGIN') = (client_account_id IS NOT NULL)
         AND (link_type = 'STAFF') = (staff_user_id IS NOT NULL)
         AND (kind <> 'APPROVER' OR link_type = 'STAFF')
         AND auth_method IN ('LINK', 'EMAIL_CODE', 'ACCESS_CODE')
         AND (access_code_hash IS NULL OR (auth_method = 'ACCESS_CODE' AND esign_hex64(access_code_hash)))
         AND color_index BETWEEN 0 AND 7 AND reminder_count >= 0 AND token_version >= 0
         AND (status = 'SIGNED') = (signed_at IS NOT NULL)
         AND (status = 'DECLINED') = (declined_at IS NOT NULL)
         AND (decline_reason IS NULL OR (declined_at IS NOT NULL AND esign_text_ok(decline_reason, 500)))
         AND (consent_version_id IS NULL) = (consented_at IS NULL)
         AND esign_text_ok(printed_name, 200)
         AND (signature_method IS NULL) = (adopted_at IS NULL)
         AND (signature_method IS NULL OR printed_name IS NOT NULL)
         AND (CASE signature_method WHEN 'TYPED' THEN esign_text_ok(signature_text, 200) AND signature_png IS NULL
              ELSE signature_text IS NULL AND (signature_png IS NOT NULL) = (signature_method IS NOT NULL) END)
         AND (CASE initials_method WHEN 'TYPED' THEN esign_text_ok(initials_text, 10) AND initials_png IS NULL
              ELSE initials_text IS NULL AND (initials_png IS NOT NULL) = (initials_method IS NOT NULL) END)
         AND (initials_method IS NULL OR signature_method IS NOT NULL)
         AND octet_length(signature_png) <= 204800 AND octet_length(initials_png) <= 204800);

ALTER TABLE esign_verification_codes ADD CONSTRAINT esign_verification_codes_values
  CHECK (tries >= 0 AND cardinality(sent_times) <= 5 AND array_position(sent_times, NULL) IS NULL
         AND (CASE kind WHEN 'EMAIL' THEN (code_hash IS NULL) = (expires_at IS NULL)
              ELSE code_hash IS NULL AND expires_at IS NULL AND cardinality(sent_times) = 0 END)
         AND (code_hash IS NULL OR esign_hex64(code_hash)));

ALTER TABLE esign_fields ADD CONSTRAINT esign_fields_values
  CHECK (position BETWEEN 0 AND 499 AND page_index BETWEEN 0 AND 99
         AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND w BETWEEN 0 AND 1 AND h BETWEEN 0 AND 1
         AND esign_text_ok(label, 200) AND merge_key ~ '^[A-Z][A-Z_]{0,39}$'
         AND cardinality(options) <= 2000 AND array_position(options, NULL) IS NULL
         AND (cardinality(options) = 0 OR array_ndims(options) = 1)
         AND esign_text_ok(group_key, 100)
         AND (recipient_id IS NOT NULL
              OR type NOT IN ('SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'ATTACHMENT')));

ALTER TABLE esign_events ADD CONSTRAINT esign_events_values
  CHECK (esign_text_ok(actor_name, 200) AND (recipient_id IS NULL) = (recipient_name IS NULL)
         AND esign_text_ok(recipient_name, 200) AND esign_text_ok(reason, 500)
         AND char_length(user_agent) <= 512);

ALTER TABLE esign_approval_notes ADD CONSTRAINT esign_approval_notes_values
  CHECK (esign_text_ok(note, 500) AND (decision = 'APPROVE' OR note IS NOT NULL));

-- The nine Firm Sign email templates (apps/api/src/notify).
ALTER TABLE esign_emails ADD CONSTRAINT esign_emails_values
  CHECK ((recipient_id IS NULL) <> (user_id IS NULL)
         AND template IN ('esign.request', 'esign.reminder', 'esign.expiring', 'esign.voided',
                          'esign.declined', 'esign.completed', 'esign.code',
                          'esign.approval-requested', 'esign.staff-update')
         AND (user_id IS NULL OR template = 'esign.staff-update')
         AND (status = 'SENT') = (sent_at IS NOT NULL)
         AND (error IS NULL OR (status = 'FAILED' AND error ~ '^[A-Za-z0-9_.]{1,100}$'))
         AND attempts >= 0);

ALTER TABLE esign_signing_links ADD CONSTRAINT esign_signing_links_values
  CHECK (esign_hex64(token_hash) AND token_version >= 0
         AND (purpose = 'SIGN' OR expires_at IS NOT NULL));

ALTER TABLE esign_pending_uploads ADD CONSTRAINT esign_pending_uploads_values
  CHECK (esign_hex64(token_hash) AND esign_hex64(sha256) AND esign_text_ok(file_name, 255)
         AND content_type IN ('application/pdf', 'image/jpeg', 'image/png')
         AND size_bytes BETWEEN 1 AND 10485760
         AND (CASE kind
              WHEN 'DOCUMENT' THEN user_id IS NOT NULL AND recipient_id IS NULL AND field_id IS NULL
                AND esign_key_ok(s3_key, business_id, request_id, '')
              ELSE user_id IS NULL AND recipient_id IS NOT NULL AND field_id IS NOT NULL
                AND esign_key_ok(s3_key, business_id, request_id, 'attachments/') END));

ALTER TABLE esign_attachments ADD CONSTRAINT esign_attachments_values
  CHECK (esign_key_ok(s3_key, business_id, request_id, 'attachments/') AND esign_hex64(sha256)
         AND esign_text_ok(file_name, 255)
         AND content_type IN ('application/pdf', 'image/jpeg', 'image/png')
         AND size_bytes BETWEEN 1 AND 10485760
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE esign_kiosk_locks ADD CONSTRAINT esign_kiosk_locks_values
  CHECK (esign_text_ok(signer_name, 200) AND wrong_passwords BETWEEN 0 AND 5
         AND link_expires_at > started_at);

ALTER TABLE esign_bulk_batches ADD CONSTRAINT esign_bulk_batches_values
  CHECK (esign_text_ok(template_name, 200) AND esign_text_ok(title, 200)
         AND jsonb_typeof(roles) = 'array' AND jsonb_array_length(roles) <= 20);

-- request_id has no foreign key on purpose: it is chosen with the batch, before the job makes the
-- DRAFT (in a later transaction), so a rerun finds the DRAFT it made; `created` says it exists.
-- The client and the engagement are the firm's own (same-firm foreign keys above).
ALTER TABLE esign_bulk_items ADD CONSTRAINT esign_bulk_items_values
  CHECK (position BETWEEN 0 AND 199 AND attempts BETWEEN 0 AND 3
         AND (state = 'NOT_SENT') = (problem IS NOT NULL) AND problem ~ '^[A-Z][A-Z0-9_]{0,63}$'
         AND (state <> 'SENT' OR created));

-- ---------- Rules on change ----------
-- The columns whose values differ between two versions of a row.
CREATE FUNCTION esign_changed(new_row jsonb, old_row jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT coalesce(array_agg(n.key), '{}') FROM jsonb_each(new_row) AS n
    JOIN jsonb_each(old_row) AS o USING (key) WHERE n.value IS DISTINCT FROM o.value
$$;

-- An update may change only the columns named as the trigger's arguments. A scan result is set
-- once (from PENDING), and a bulk row changes only while QUEUED.
CREATE FUNCTION esign_only_columns() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  changed text[] := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
BEGIN
  IF NOT changed <@ TG_ARGV::text[] THEN
    RAISE EXCEPTION '%: only % can change', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  IF changed && ARRAY['scan_status', 'scanned_at'] AND to_jsonb(OLD) ->> 'scan_status' <> 'PENDING' THEN
    RAISE EXCEPTION '%: a scan result cannot change', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF to_jsonb(OLD) ->> 'state' IN ('SENT', 'NOT_SENT') THEN
    RAISE EXCEPTION '%: a row changes only while QUEUED', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER esign_documents_update BEFORE UPDATE ON esign_documents
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('scan_status', 'scanned_at');
CREATE TRIGGER esign_attachments_update BEFORE UPDATE ON esign_attachments
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('scan_status', 'scanned_at');
CREATE TRIGGER esign_emails_update BEFORE UPDATE ON esign_emails
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('status', 'error', 'attempts', 'sent_at');
CREATE TRIGGER esign_kiosk_locks_update BEFORE UPDATE ON esign_kiosk_locks
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('active_at', 'wrong_passwords');
CREATE TRIGGER esign_bulk_items_update BEFORE UPDATE ON esign_bulk_items
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('engagement_id', 'created', 'state', 'problem', 'attempts');
CREATE TRIGGER esign_verification_codes_update BEFORE UPDATE ON esign_verification_codes
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('code_hash', 'expires_at', 'tries', 'sent_times', 'updated_at');
CREATE TRIGGER esign_settings_update BEFORE UPDATE ON esign_settings
  FOR EACH ROW EXECUTE FUNCTION esign_only_columns('expiry_days', 'reminder_first_after_days',
    'reminder_every_days', 'reminder_max', 'expiry_warning_days', 'auth_method',
    'require_approval', 'email_message', 'updated_at');

-- Requests. Inserted as a DRAFT. The status moves only forward: DRAFT and NEEDS_APPROVAL to each
-- other or out (sent; NEEDS_APPROVAL may be voided), open statuses among themselves or to
-- DECLINED, EXPIRED or VOIDED, PARTIALLY_SIGNED to COMPLETED; a closed request keeps its status.
-- Who sent it, where it came from and its template never change; what was sent is frozen once
-- sent; the closing facts are set once. A closed request then changes only by getting its filed
-- documents (which must be its own final PDF and certificate) and the request that replaced it.
CREATE FUNCTION esign_requests_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  open_statuses CONSTANT text[] := ARRAY['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'];
  changed text[];
  col text;
  allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'esign requests: a request starts as a DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  changed := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
  IF changed && ARRAY['id', 'business_id', 'source', 'sender_user_id', 'created_at',
                      'replaces_request_id', 'template_id', 'template_version'] THEN
    RAISE EXCEPTION 'esign requests: the sender, source and template never change'
      USING ERRCODE = 'check_violation';
  END IF;
  FOREACH col IN ARRAY changed LOOP
    IF col = ANY (ARRAY['completed_at', 'final_sha256', 'certificate_sha256', 'final_document_id',
                        'certificate_document_id', 'expired_at', 'voided_at', 'void_reason',
                        'voided_by_user_id', 'replaced_by_request_id', 'expiry_warned_at'])
       AND to_jsonb(OLD) ->> col IS NOT NULL THEN
      RAISE EXCEPTION 'esign requests: % is set once', col USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF OLD.status NOT IN ('DRAFT', 'NEEDS_APPROVAL')
     AND changed && ARRAY['client_id', 'engagement_id', 'routing', 'page_plan', 'sent_at',
       'expires_at', 'original_sha256', 'expiry_days', 'reminder_first_after_days',
       'reminder_every_days', 'reminder_max', 'expiry_warning_days'] THEN
    RAISE EXCEPTION 'esign requests: what was sent cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED')
     AND NOT changed <@ ARRAY['final_document_id', 'certificate_document_id',
                              'replaced_by_request_id', 'last_activity_at'] THEN
    RAISE EXCEPTION 'esign requests: a % request cannot change', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    allowed := CASE
      WHEN OLD.status = 'DRAFT' THEN NEW.status IN ('NEEDS_APPROVAL', 'SENT')
      WHEN OLD.status = 'NEEDS_APPROVAL' THEN NEW.status IN ('DRAFT', 'SENT', 'VOIDED')
      WHEN OLD.status::text = ANY (open_statuses) THEN
        NEW.status::text = ANY (open_statuses) OR NEW.status IN ('DECLINED', 'EXPIRED', 'VOIDED')
        OR (NEW.status = 'COMPLETED' AND OLD.status = 'PARTIALLY_SIGNED')
      ELSE false END;
    IF NOT allowed THEN
      RAISE EXCEPTION 'esign requests: % cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (NEW.final_document_id IS DISTINCT FROM OLD.final_document_id
      AND NOT EXISTS (SELECT 1 FROM documents d
                      WHERE d.id = NEW.final_document_id AND d.esign_request_id = NEW.id
                        AND d.sha256 = NEW.final_sha256 AND d.s3_key LIKE '%/final/%'))
     OR (NEW.certificate_document_id IS DISTINCT FROM OLD.certificate_document_id
      AND NOT EXISTS (SELECT 1 FROM documents d
                      WHERE d.id = NEW.certificate_document_id AND d.esign_request_id = NEW.id
                        AND d.sha256 = NEW.certificate_sha256 AND d.s3_key LIKE '%/certificate/%')) THEN
    RAISE EXCEPTION 'esign requests: the filed documents must be its own final PDF and certificate'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.replaced_by_request_id IS DISTINCT FROM OLD.replaced_by_request_id
     AND NOT EXISTS (SELECT 1 FROM esign_requests r
                     WHERE r.id = NEW.replaced_by_request_id AND r.replaces_request_id = NEW.id) THEN
    RAISE EXCEPTION 'esign requests: the replacement must name this request'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER esign_requests_rules
  BEFORE INSERT OR UPDATE ON esign_requests
  FOR EACH ROW EXECUTE FUNCTION esign_requests_rules();

-- A request's documents, recipients and fields are added and removed only while it is a DRAFT
-- (a deleted draft's cascade finds no request); the request is held FOR SHARE, so a send waits.
-- After that a field changes only its value, and a recipient only its progress (and, until they
-- sign, name, email and phone: a correction); once signed, a recipient's identity, consent and
-- adopted marks never change. token_version only rises; nothing moves to another request.
-- Values after the DRAFT: a signer's field (one with a recipient) only while the request is open
-- (SENT, DELIVERED, VIEWED, PARTIALLY_SIGNED) and that recipient has not signed, both held FOR
-- SHARE; so finish writes the values before it sets signed_at. A sender's field (no recipient)
-- only before sending (DRAFT, NEEDS_APPROVAL). A closed request's (COMPLETED, DECLINED, EXPIRED,
-- VOIDED) recipients never change, except token_version rising (ending a kiosk session revokes
-- the signer's session after the request closed); a decline writes the recipient before the request.
CREATE FUNCTION esign_request_parts_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  open_statuses CONSTANT text[] := ARRAY['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'];
  req_status text;
  changed text[];
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    SELECT r.status INTO req_status FROM esign_requests r
     WHERE r.id = CASE TG_OP WHEN 'DELETE' THEN OLD.request_id ELSE NEW.request_id END
     FOR SHARE;
    IF req_status IS DISTINCT FROM 'DRAFT' AND (TG_OP = 'INSERT' OR req_status IS NOT NULL) THEN
      RAISE EXCEPTION '%: added or removed only while the request is a DRAFT', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  changed := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
  IF changed && ARRAY['id', 'business_id', 'request_id', 'created_at'] THEN
    RAISE EXCEPTION '%: a row never moves to another request', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.status INTO req_status FROM esign_requests r WHERE r.id = NEW.request_id FOR SHARE;

  IF TG_TABLE_NAME = 'esign_fields' THEN
    IF req_status <> 'DRAFT' AND NOT changed <@ ARRAY['value_enc', 'filled'] THEN
      RAISE EXCEPTION 'esign fields: placed only while the request is a DRAFT'
        USING ERRCODE = 'check_violation';
    END IF;
    IF req_status <> 'DRAFT' AND changed && ARRAY['value_enc', 'filled'] THEN
      IF NEW.recipient_id IS NULL AND req_status <> 'NEEDS_APPROVAL' THEN
        RAISE EXCEPTION 'esign fields: a sender''s value changes only before the request is sent'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.recipient_id IS NOT NULL AND (req_status <> ALL (open_statuses) OR NOT EXISTS (
           SELECT 1 FROM esign_recipients p
            WHERE p.id = NEW.recipient_id AND p.signed_at IS NULL FOR SHARE)) THEN
        RAISE EXCEPTION 'esign fields: a signer''s value changes only while the request is open and they have not signed'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF req_status IN ('COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED')
     AND NOT changed <@ ARRAY['token_version'] THEN
    RAISE EXCEPTION 'esign recipients: a % request''s recipients never change', req_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.token_version < OLD.token_version THEN
    RAISE EXCEPTION 'esign recipients: token_version only rises' USING ERRCODE = 'check_violation';
  END IF;
  IF req_status NOT IN ('DRAFT', 'NEEDS_APPROVAL')
     AND changed && ARRAY['position', 'kind', 'role', 'role_label', 'routing_order', 'link_type',
       'client_account_id', 'staff_user_id', 'delivery', 'auth_method', 'color_index'] THEN
    RAISE EXCEPTION 'esign recipients: who signs what, and how, is fixed once sent'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.signed_at IS NOT NULL
     AND changed && ARRAY['name', 'email', 'phone', 'signed_at', 'consent_version_id',
       'consented_at', 'printed_name', 'signature_method', 'signature_text', 'signature_png',
       'initials_method', 'initials_text', 'initials_png', 'adopted_at'] THEN
    RAISE EXCEPTION 'esign recipients: a signer''s identity and signature are fixed once signed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER esign_documents_parts BEFORE INSERT OR DELETE ON esign_documents
  FOR EACH ROW EXECUTE FUNCTION esign_request_parts_rules();
CREATE TRIGGER esign_recipients_parts BEFORE INSERT OR UPDATE OR DELETE ON esign_recipients
  FOR EACH ROW EXECUTE FUNCTION esign_request_parts_rules();
CREATE TRIGGER esign_fields_parts BEFORE INSERT OR UPDATE OR DELETE ON esign_fields
  FOR EACH ROW EXECUTE FUNCTION esign_request_parts_rules();

-- What a signer adds while signing: an attachment (added or removed), an ATTACHMENT upload, and a
-- SIGN or IN_PERSON link, only while the request is open and that recipient has not signed, the
-- request and the recipient held FOR SHARE (so a close or a finish waits). A send or a reminder
-- sets the request's status before its links. A COPY link (the completed copy) and a DOCUMENT
-- upload (the sender's, checked by the API) are not signing; a deleted draft's cascade finds no
-- request.
CREATE FUNCTION esign_signing_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  open_statuses CONSTANT text[] := ARRAY['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'];
  row_data jsonb := to_jsonb(CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END);
  req_status text;
BEGIN
  IF (TG_TABLE_NAME = 'esign_pending_uploads' AND row_data ->> 'kind' <> 'ATTACHMENT')
     OR (TG_TABLE_NAME = 'esign_signing_links' AND row_data ->> 'purpose' = 'COPY') THEN
    RETURN NEW;
  END IF;
  SELECT r.status INTO req_status FROM esign_requests r
   WHERE r.id = (row_data ->> 'request_id')::uuid FOR SHARE;
  IF TG_OP = 'DELETE' AND NOT FOUND THEN
    RETURN OLD;
  END IF;
  IF req_status IS NULL OR req_status <> ALL (open_statuses) OR NOT EXISTS (
       SELECT 1 FROM esign_recipients p
        WHERE p.id = (row_data ->> 'recipient_id')::uuid AND p.signed_at IS NULL FOR SHARE) THEN
    RAISE EXCEPTION '%: only while the request is open and the recipient has not signed', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER esign_attachments_signing BEFORE INSERT OR DELETE ON esign_attachments
  FOR EACH ROW EXECUTE FUNCTION esign_signing_rules();
CREATE TRIGGER esign_pending_uploads_signing BEFORE INSERT ON esign_pending_uploads
  FOR EACH ROW EXECUTE FUNCTION esign_signing_rules();
CREATE TRIGGER esign_signing_links_signing BEFORE INSERT ON esign_signing_links
  FOR EACH ROW EXECUTE FUNCTION esign_signing_rules();

-- Templates: an archived template never changes; the owner and creation never do; `version`
-- moves only to the next version, once that version is saved. Versions are numbered in order and
-- added only to an active template (held FOR SHARE, so an archive waits).
CREATE FUNCTION esign_templates_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  changed text[];
  newest integer;
  current_version integer;
  archived timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'esign_template_versions' THEN
    SELECT t.version, t.archived_at INTO current_version, archived FROM esign_templates t
     WHERE t.id = NEW.template_id FOR SHARE;
    SELECT max(v.version) INTO newest FROM esign_template_versions v
     WHERE v.template_id = NEW.template_id;
    IF archived IS NOT NULL OR NEW.version <> coalesce(newest, 0) + 1
       OR (newest IS NOT NULL AND current_version <> newest) THEN
      RAISE EXCEPTION 'esign template versions: the next version of an active template only'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'esign templates: a template starts active, at version 1'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  changed := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
  IF (OLD.archived_at IS NOT NULL AND changed <> '{}')
     OR changed && ARRAY['id', 'business_id', 'owner_user_id', 'created_at'] THEN
    RAISE EXCEPTION 'esign templates: an archived template, its owner and creation never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version <> OLD.version AND (NEW.version <> OLD.version + 1 OR NOT EXISTS (
       SELECT 1 FROM esign_template_versions v
       WHERE v.template_id = NEW.id AND v.version = NEW.version)) THEN
    RAISE EXCEPTION 'esign templates: version moves to the next saved version only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER esign_templates_rules BEFORE INSERT OR UPDATE ON esign_templates
  FOR EACH ROW EXECUTE FUNCTION esign_templates_rules();
CREATE TRIGGER esign_template_versions_rules BEFORE INSERT ON esign_template_versions
  FOR EACH ROW EXECUTE FUNCTION esign_templates_rules();

-- ---------- The scan exception: Firm Sign's filed copies start CLEAN ----------
-- documents_rules (r0_documents, r0_intake) as before, plus: a document with esign_request_id is
-- that request's server-made final PDF or certificate, filed after it is COMPLETED and before its
-- document ids are set: FIRM_TO_CLIENT, application/pdf, CLEAN with scanned_at, legal hold on, no
-- retention (kept for good), on the request's client and engagement, its key under the request's
-- final/ or certificate/ folder and its hash the request's. It is the only other way a document
-- starts scanned; signer attachments and uploads always wait for the scan. esign_request_id is
-- set on insert only.
CREATE OR REPLACE FUNCTION documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.esign_request_id IS NOT NULL THEN
      -- Held FOR SHARE until commit: the request cannot be completed twice or its documents set
      -- by another transaction meanwhile.
      PERFORM 1 FROM esign_requests r WHERE r.id = NEW.esign_request_id FOR SHARE;
      IF NEW.direction <> 'FIRM_TO_CLIENT' OR NEW.content_type <> 'application/pdf'
         OR NEW.scan_status <> 'CLEAN' OR NEW.scanned_at IS NULL OR NOT NEW.legal_hold
         OR NEW.retention_until IS NOT NULL OR NEW.lead_upload_id IS NOT NULL
         OR NEW.intake_id IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM esign_requests r
           WHERE r.id = NEW.esign_request_id AND r.status = 'COMPLETED'
             AND r.client_id = NEW.client_id AND r.engagement_id = NEW.engagement_id
             AND ((starts_with(NEW.s3_key, 'tenant/' || r.business_id || '/esign/' || r.id || '/final/')
                   AND NEW.sha256 = r.final_sha256 AND r.final_document_id IS NULL)
               OR (starts_with(NEW.s3_key, 'tenant/' || r.business_id || '/esign/' || r.id || '/certificate/')
                   AND NEW.sha256 = r.certificate_sha256 AND r.certificate_document_id IS NULL))) THEN
        RAISE EXCEPTION 'documents: a Firm Sign copy is the completed request''s own final PDF or certificate, filed CLEAN under legal hold'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.lead_upload_id IS NOT NULL THEN
      IF NEW.direction <> 'CLIENT_TO_FIRM' OR NOT EXISTS (
        SELECT 1 FROM lead_uploads u JOIN leads l ON l.id = u.lead_id
        WHERE u.id = NEW.lead_upload_id
          AND u.s3_key = NEW.s3_key AND u.sha256 = NEW.sha256 AND u.size_bytes = NEW.size_bytes
          AND u.content_type = NEW.content_type
          AND u.scan_status = NEW.scan_status AND u.scanned_at IS NOT DISTINCT FROM NEW.scanned_at
          AND l.status = 'CONVERTED' AND l.engagement_id = NEW.engagement_id
      ) THEN
        RAISE EXCEPTION 'documents: a carried-over upload must match its lead upload and the converted engagement'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'documents: a new document starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'CLIENT_TO_FIRM' AND NOT EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = NEW.engagement_id AND e.status IN ('PENDING', 'ACTIVE')
    ) THEN
      RAISE EXCEPTION 'documents: a client can upload only to an open engagement'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id <> OLD.engagement_id OR NEW.direction <> OLD.direction
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.lead_upload_id IS DISTINCT FROM OLD.lead_upload_id
     OR NEW.esign_request_id IS DISTINCT FROM OLD.esign_request_id
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'documents: the file, its S3 key, its engagement and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'documents: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.retention_until IS NULL AND NEW.retention_until IS NOT NULL)
     OR NEW.retention_until < OLD.retention_until THEN
    RAISE EXCEPTION 'documents: retention_until can only move later'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------- The module switch ----------
-- enabled_modules holds known modules only, once each; the app never changes it. A change (an
-- insert with modules, or an update of them) is accepted only from app_set_business_module, which
-- runs as the migrate role and marks its own transaction for that one firm: the app role cannot
-- pass the role check, whatever it sets.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_enabled_modules
  CHECK (enabled_modules IS NOT NULL AND enabled_modules <@ ARRAY['esign', 'calculators']
         AND (cardinality(enabled_modules) = 0 OR array_ndims(enabled_modules) = 1)
         AND esign_distinct(enabled_modules));

CREATE FUNCTION business_settings_modules_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.enabled_modules IS DISTINCT FROM
       (CASE TG_OP WHEN 'INSERT' THEN '{}'::text[] ELSE OLD.enabled_modules END)
     AND (current_setting('app.module_switch', true) IS DISTINCT FROM NEW.business_id::text
          OR NOT pg_has_role(current_user,
                             (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'MEMBER')) THEN
    RAISE EXCEPTION 'business settings: enabled_modules changes only through app_set_business_module'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER business_settings_modules_guard
  BEFORE INSERT OR UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION business_settings_modules_guard();

-- Turns one module on or off for one firm, with a one-line reason, and writes the firm's audit
-- row (module.enabled or module.disabled; no change, no row). Answers the firm's modules. Ops run
-- it as the migrate role (packages/db/scripts/set-module.mjs); EXECUTE is revoked from everyone
-- else. Its scope settings are its own: the caller's come back when it returns.
CREATE FUNCTION app_set_business_module(p_business_id uuid, p_module text, p_enabled boolean,
                                        p_reason text)
  RETURNS text[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET app.scope = 'business'
  SET app.current_business_id = ''
  SET app.module_switch = ''
  AS $$
DECLARE
  reason text := btrim(p_reason, E' \t\r\n');
  before text[];
  after text[];
BEGIN
  IF p_module IS NULL OR p_module NOT IN ('esign', 'calculators') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'app_set_business_module: the module is esign or calculators, turned on or off'
      USING ERRCODE = 'check_violation';
  END IF;
  IF reason IS NULL OR reason = '' OR char_length(reason) > 500 OR reason ~ '[[:cntrl:]]'
     OR reason ~ '[؜᠎​‪-‮⁠-⁤⁦-⁯﻿￹-￻]' THEN
    RAISE EXCEPTION 'app_set_business_module: give a one-line reason (up to 500 characters)'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('app.current_business_id', p_business_id::text, true);
  PERFORM set_config('app.module_switch', p_business_id::text, true);
  PERFORM 1 FROM businesses b WHERE b.id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_set_business_module: no such firm' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT s.enabled_modules INTO before FROM business_settings s
   WHERE s.business_id = p_business_id FOR UPDATE;
  after := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(before, '{}') || p_module) AS u(m)
                  WHERE m <> p_module OR p_enabled ORDER BY m);
  IF before IS NULL THEN
    INSERT INTO business_settings (business_id, enabled_modules, updated_at)
    VALUES (p_business_id, after, now())
    ON CONFLICT (business_id) DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'app_set_business_module: the firm''s settings changed meanwhile; run it again'
        USING ERRCODE = 'serialization_failure';
    END IF;
  ELSIF before IS DISTINCT FROM after THEN
    UPDATE business_settings SET enabled_modules = after, updated_at = now()
     WHERE business_id = p_business_id;
  END IF;

  IF after IS DISTINCT FROM coalesce(before, '{}') THEN
    INSERT INTO audit_logs (id, business_id, action, entity_type, entity_id, metadata)
    VALUES (gen_random_uuid(), p_business_id,
            CASE WHEN p_enabled THEN 'module.enabled' ELSE 'module.disabled' END,
            'business', p_business_id::text,
            jsonb_build_object('module', p_module, 'reason', reason));
  END IF;
  RETURN after;
END
$$;

REVOKE ALL ON FUNCTION app_set_business_module(uuid, text, boolean, text) FROM PUBLIC;

-- The firms a job runs for: the ACTIVE firms with a module on (ids only), for Firm Sign's
-- completion, lifecycle and bulk jobs. It reads every firm's settings in platform scope through a
-- policy only its owner (the migrate role) matches; the app role may run it.
CREATE POLICY business_settings_module_list ON business_settings FOR SELECT TO CURRENT_USER
  USING (app_scope() = 'platform');

CREATE FUNCTION app_firms_with_module(p_module text) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET app.scope = 'platform'
  AS $$
  SELECT b.id FROM businesses b JOIN business_settings s ON s.business_id = b.id
   WHERE b.status = 'ACTIVE' AND p_module = ANY (s.enabled_modules)
   ORDER BY b.id
$$;

REVOKE ALL ON FUNCTION app_firms_with_module(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_firms_with_module(text) TO firmivra_app;
