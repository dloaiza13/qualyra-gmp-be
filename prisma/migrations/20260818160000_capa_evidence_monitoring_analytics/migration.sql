-- Phase 19 adds tenant-isolated managed evidence and durable, deduplicated
-- CAPA due-date notifications. Analytics remain derived from source records.
CREATE TYPE "CapaEvidenceScanStatus" AS ENUM ('QUARANTINED', 'AVAILABLE', 'REJECTED');
CREATE TYPE "CapaNotificationSubjectType" AS ENUM ('ACTION', 'EFFECTIVENESS_REVIEW');
CREATE TYPE "CapaNotificationDueState" AS ENUM ('DUE_SOON', 'OVERDUE', 'ESCALATED');
CREATE TYPE "CapaNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

CREATE TABLE "capa_evidence_uploads" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "action_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(150) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "scan_status" "CapaEvidenceScanStatus" NOT NULL,
  "scan_engine" VARCHAR(100) NOT NULL,
  "scan_result" VARCHAR(500) NOT NULL,
  "scanned_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_evidence_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_evidence_uploads_metadata_check" CHECK (
    char_length(btrim("file_name")) BETWEEN 1 AND 255
    AND char_length(btrim("content_type")) BETWEEN 3 AND 150
    AND "size_bytes" BETWEEN 1 AND 26214400
    AND "sha256" ~ '^[0-9a-f]{64}$'
    AND char_length(btrim("object_key")) BETWEEN 10 AND 500
    AND char_length(btrim("scan_engine")) BETWEEN 3 AND 100
    AND char_length(btrim("scan_result")) BETWEEN 2 AND 500
    AND "scanned_at" >= "created_at" - interval '1 minute'
    AND "expires_at" > "created_at"
    AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
  )
);

CREATE UNIQUE INDEX "capa_evidence_uploads_tenant_id_id_key"
  ON "capa_evidence_uploads"("tenant_id", "id");
CREATE UNIQUE INDEX "capa_evidence_uploads_object_key_key"
  ON "capa_evidence_uploads"("object_key");
CREATE INDEX "capa_evidence_uploads_action_status_expiry_idx"
  ON "capa_evidence_uploads"("tenant_id", "action_id", "scan_status", "expires_at");

ALTER TABLE "capa_action_evidence_references"
  ADD COLUMN "evidence_upload_id" UUID;
CREATE UNIQUE INDEX "capa_action_evidence_upload_id_key"
  ON "capa_action_evidence_references"("tenant_id", "evidence_upload_id");

CREATE TABLE "capa_notifications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "action_id" UUID,
  "effectiveness_review_id" UUID,
  "recipient_user_id" UUID NOT NULL,
  "subject_type" "CapaNotificationSubjectType" NOT NULL,
  "due_state" "CapaNotificationDueState" NOT NULL,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "deduplication_key" VARCHAR(300) NOT NULL,
  "status" "CapaNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_notifications_subject_check" CHECK (
    ("subject_type" = 'ACTION' AND "action_id" IS NOT NULL AND "effectiveness_review_id" IS NULL)
    OR
    ("subject_type" = 'EFFECTIVENESS_REVIEW' AND "action_id" IS NULL AND "effectiveness_review_id" IS NOT NULL)
  ),
  CONSTRAINT "capa_notifications_delivery_check" CHECK (
    "attempts" BETWEEN 0 AND 10
    AND (
      ("status" = 'PENDING' AND "attempts" = 0 AND "delivered_at" IS NULL)
      OR ("status" = 'PROCESSING' AND "attempts" BETWEEN 1 AND 10 AND "delivered_at" IS NULL)
      OR ("status" = 'FAILED' AND "attempts" BETWEEN 1 AND 10 AND "delivered_at" IS NULL AND "last_error" IS NOT NULL)
      OR ("status" = 'DELIVERED' AND "attempts" BETWEEN 1 AND 10 AND "delivered_at" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "capa_notifications_tenant_dedup_key"
  ON "capa_notifications"("tenant_id", "deduplication_key");
CREATE INDEX "capa_notifications_status_created_idx"
  ON "capa_notifications"("tenant_id", "status", "created_at");
CREATE INDEX "capa_notifications_recipient_created_idx"
  ON "capa_notifications"("tenant_id", "recipient_user_id", "created_at");

ALTER TABLE "capa_evidence_uploads"
  ADD CONSTRAINT "capa_evidence_uploads_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_evidence_uploads"
  ADD CONSTRAINT "capa_evidence_uploads_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_evidence_uploads"
  ADD CONSTRAINT "capa_evidence_uploads_action_fkey"
  FOREIGN KEY ("tenant_id", "action_id") REFERENCES "capa_actions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_evidence_uploads"
  ADD CONSTRAINT "capa_evidence_uploads_uploader_fkey"
  FOREIGN KEY ("tenant_id", "uploaded_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_evidence_references"
  ADD CONSTRAINT "capa_action_evidence_upload_fkey"
  FOREIGN KEY ("tenant_id", "evidence_upload_id") REFERENCES "capa_evidence_uploads"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capa_notifications"
  ADD CONSTRAINT "capa_notifications_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_notifications"
  ADD CONSTRAINT "capa_notifications_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_notifications"
  ADD CONSTRAINT "capa_notifications_action_fkey"
  FOREIGN KEY ("tenant_id", "action_id") REFERENCES "capa_actions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_notifications"
  ADD CONSTRAINT "capa_notifications_review_fkey"
  FOREIGN KEY ("tenant_id", "effectiveness_review_id") REFERENCES "capa_effectiveness_reviews"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_notifications"
  ADD CONSTRAINT "capa_notifications_recipient_fkey"
  FOREIGN KEY ("tenant_id", "recipient_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_capa_evidence_upload_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Managed CAPA evidence cannot be deleted.' USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.action_id IS DISTINCT FROM NEW.action_id
    OR OLD.uploaded_by_user_id IS DISTINCT FROM NEW.uploaded_by_user_id
    OR OLD.file_name IS DISTINCT FROM NEW.file_name
    OR OLD.content_type IS DISTINCT FROM NEW.content_type
    OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes
    OR OLD.sha256 IS DISTINCT FROM NEW.sha256
    OR OLD.object_key IS DISTINCT FROM NEW.object_key
    OR OLD.scan_status IS DISTINCT FROM NEW.scan_status
    OR OLD.scan_engine IS DISTINCT FROM NEW.scan_engine
    OR OLD.scan_result IS DISTINCT FROM NEW.scan_result
    OR OLD.scanned_at IS DISTINCT FROM NEW.scanned_at
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
  THEN
    RAISE EXCEPTION 'Managed CAPA evidence metadata is immutable after analysis.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_capa_evidence_upload_mutation() FROM PUBLIC;

CREATE FUNCTION public.guard_capa_evidence_upload_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scan_status <> 'AVAILABLE' OR NOT EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.capa_id
      AND action.id = NEW.action_id
      AND action.assigned_to_user_id = NEW.uploaded_by_user_id
      AND action.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Managed evidence may only be uploaded by the assignee to an open CAPA action.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_capa_evidence_upload_insert() FROM PUBLIC;

CREATE TRIGGER capa_evidence_upload_insert_guard
BEFORE INSERT ON "capa_evidence_uploads"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_evidence_upload_insert();

CREATE TRIGGER capa_evidence_upload_mutation_guard
BEFORE UPDATE OR DELETE ON "capa_evidence_uploads"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_evidence_upload_mutation();

ALTER TABLE "capa_evidence_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_evidence_uploads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_evidence_uploads"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
ALTER TABLE "capa_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_notifications"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "capa_evidence_uploads", "capa_notifications" TO qualyra_runtime;
REVOKE DELETE ON TABLE "capa_evidence_uploads", "capa_notifications" FROM qualyra_runtime;
