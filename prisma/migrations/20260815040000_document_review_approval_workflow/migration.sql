-- CreateEnum
CREATE TYPE "DocumentWorkflowStatus" AS ENUM (
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED'
);

-- CreateTable
CREATE TABLE "document_workflows" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "approver_user_id" UUID NOT NULL,
  "status" "DocumentWorkflowStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "review_comment" VARCHAR(2000),
  "approval_comment" VARCHAR(2000),
  "reviewed_at" TIMESTAMPTZ(3),
  "approved_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "document_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_workflows_distinct_assignees_check"
    CHECK ("reviewer_user_id" <> "approver_user_id"),
  CONSTRAINT "document_workflows_review_comment_not_blank_check"
    CHECK ("review_comment" IS NULL OR char_length(btrim("review_comment")) BETWEEN 3 AND 2000),
  CONSTRAINT "document_workflows_approval_comment_not_blank_check"
    CHECK ("approval_comment" IS NULL OR char_length(btrim("approval_comment")) BETWEEN 3 AND 2000)
);

-- CreateIndex
CREATE UNIQUE INDEX "document_workflows_tenant_id_id_key"
  ON "document_workflows"("tenant_id", "id");
CREATE UNIQUE INDEX "document_workflows_tenant_version_key"
  ON "document_workflows"("tenant_id", "document_version_id");
CREATE INDEX "document_workflows_tenant_document_created_idx"
  ON "document_workflows"("tenant_id", "document_id", "created_at");
CREATE INDEX "document_workflows_tenant_reviewer_status_idx"
  ON "document_workflows"("tenant_id", "reviewer_user_id", "status");
CREATE INDEX "document_workflows_tenant_approver_status_idx"
  ON "document_workflows"("tenant_id", "approver_user_id", "status");

-- AddForeignKey
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_version_id") REFERENCES "document_versions"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_requested_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "requested_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_reviewer_user_id_fkey"
  FOREIGN KEY ("tenant_id", "reviewer_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_approver_user_id_fkey"
  FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation and immutable workflow retention.
ALTER TABLE "document_workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_workflows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_workflows"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "document_workflows"
  TO qualyra_runtime;
REVOKE DELETE ON TABLE "document_workflows"
  FROM qualyra_runtime;
