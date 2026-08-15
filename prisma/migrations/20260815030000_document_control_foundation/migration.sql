-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM (
  'POLICY',
  'SOP',
  'WORK_INSTRUCTION',
  'FORM',
  'SPECIFICATION',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM (
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'EFFECTIVE',
  'OBSOLETE'
);

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM (
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'EFFECTIVE',
  'SUPERSEDED',
  'OBSOLETE'
);

-- CreateTable
CREATE TABLE "documents" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "type" "DocumentType" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "current_version_number" INTEGER NOT NULL DEFAULT 1,
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_code_format_check"
    CHECK (
      "code" = upper(btrim("code"))
      AND "code" ~ '^[A-Z0-9][A-Z0-9._/-]{2,49}$'
    ),
  CONSTRAINT "documents_current_version_positive_check"
    CHECK ("current_version_number" > 0)
);

-- CreateTable
CREATE TABLE "document_versions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "description" VARCHAR(2000),
  "content" TEXT NOT NULL,
  "change_summary" VARCHAR(500) NOT NULL,
  "status" "DocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_versions_version_positive_check"
    CHECK ("version_number" > 0),
  CONSTRAINT "document_versions_title_not_blank_check"
    CHECK (char_length(btrim("title")) BETWEEN 3 AND 300),
  CONSTRAINT "document_versions_content_length_check"
    CHECK (char_length(btrim("content")) BETWEEN 1 AND 100000),
  CONSTRAINT "document_versions_change_summary_not_blank_check"
    CHECK (char_length(btrim("change_summary")) BETWEEN 3 AND 500)
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenant_id_id_key"
  ON "documents"("tenant_id", "id");
CREATE UNIQUE INDEX "documents_tenant_id_code_key"
  ON "documents"("tenant_id", "code");
CREATE INDEX "documents_tenant_status_updated_idx"
  ON "documents"("tenant_id", "status", "updated_at");
CREATE INDEX "documents_tenant_type_updated_idx"
  ON "documents"("tenant_id", "type", "updated_at");
CREATE UNIQUE INDEX "document_versions_tenant_id_id_key"
  ON "document_versions"("tenant_id", "id");
CREATE UNIQUE INDEX "document_versions_tenant_document_version_key"
  ON "document_versions"("tenant_id", "document_id", "version_number");
CREATE INDEX "document_versions_tenant_document_created_idx"
  ON "document_versions"("tenant_id", "document_id", "created_at");

-- AddForeignKey
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_tenant_id_owner_user_id_fkey"
  FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_tenant_id_created_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_tenant_id_created_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation and least-privilege runtime access.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_versions"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "documents", "document_versions"
  TO qualyra_runtime;
REVOKE DELETE ON TABLE "documents", "document_versions"
  FROM qualyra_runtime;
