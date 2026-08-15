-- CreateEnum
CREATE TYPE "DocumentSignatureMeaning" AS ENUM ('DOCUMENT_RELEASE');

-- CreateEnum
CREATE TYPE "DocumentAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

-- CreateTable
CREATE TABLE "document_releases" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "released_by_user_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "meaning" "DocumentSignatureMeaning" NOT NULL DEFAULT 'DOCUMENT_RELEASE',
  "authentication_method" "DocumentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "reason" VARCHAR(500) NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "record_hash" CHAR(64) NOT NULL,

  CONSTRAINT "document_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_releases_reason_not_blank_check"
    CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "document_releases_record_hash_format_check"
    CHECK ("record_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_releases_effective_not_after_release_check"
    CHECK ("effective_at" <= "released_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_releases_tenant_id_id_key"
  ON "document_releases"("tenant_id", "id");
CREATE UNIQUE INDEX "document_releases_tenant_version_key"
  ON "document_releases"("tenant_id", "document_version_id");
CREATE UNIQUE INDEX "document_releases_tenant_document_version_id_key"
  ON "document_releases"("tenant_id", "document_id", "document_version_id");
CREATE INDEX "document_releases_tenant_document_released_idx"
  ON "document_releases"("tenant_id", "document_id", "released_at");
CREATE INDEX "document_releases_tenant_effective_at_idx"
  ON "document_releases"("tenant_id", "effective_at");

-- AddForeignKey
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_tenant_id_document_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "document_versions"("tenant_id", "document_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_tenant_id_released_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "released_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_tenant_id_released_by_user_id_session_id_fkey"
  FOREIGN KEY ("tenant_id", "released_by_user_id", "session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Release evidence is tenant-isolated and immutable to the runtime role.
ALTER TABLE "document_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_releases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_releases"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "document_releases" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "document_releases" FROM qualyra_runtime;
