-- ExtendEnum
ALTER TYPE "DocumentSignatureMeaning" ADD VALUE 'DOCUMENT_OBSOLESCENCE';

-- CreateTable
CREATE TABLE "document_obsolescences" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "obsoleted_by_user_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "meaning" "DocumentSignatureMeaning" NOT NULL DEFAULT 'DOCUMENT_OBSOLESCENCE',
  "authentication_method" "DocumentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "reason" VARCHAR(500) NOT NULL,
  "obsoleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "record_hash" CHAR(64) NOT NULL,

  CONSTRAINT "document_obsolescences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_obsolescences_reason_not_blank_check"
    CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "document_obsolescences_record_hash_format_check"
    CHECK ("record_hash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "document_obsolescences_tenant_id_id_key"
  ON "document_obsolescences"("tenant_id", "id");
CREATE UNIQUE INDEX "document_obsolescences_tenant_document_key"
  ON "document_obsolescences"("tenant_id", "document_id");
CREATE UNIQUE INDEX "document_obsolescences_tenant_version_key"
  ON "document_obsolescences"("tenant_id", "document_version_id");
CREATE UNIQUE INDEX "document_obsolescences_tenant_document_version_id_key"
  ON "document_obsolescences"("tenant_id", "document_id", "document_version_id");
CREATE INDEX "document_obsolescences_tenant_obsoleted_at_idx"
  ON "document_obsolescences"("tenant_id", "obsoleted_at");

-- AddForeignKey
ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_tenant_id_document_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "document_versions"("tenant_id", "document_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_tenant_id_obsoleted_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "obsoleted_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_tenant_id_obsoleted_by_user_id_session_id_fkey"
  FOREIGN KEY ("tenant_id", "obsoleted_by_user_id", "session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Obsolescence evidence is tenant-isolated and immutable to the runtime role.
ALTER TABLE "document_obsolescences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_obsolescences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_obsolescences"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "document_obsolescences" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "document_obsolescences" FROM qualyra_runtime;
