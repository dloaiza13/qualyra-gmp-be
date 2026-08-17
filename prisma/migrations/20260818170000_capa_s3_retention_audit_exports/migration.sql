-- Phase 20 adds safe automatic purging of unconsumed evidence and immutable,
-- tenant-isolated CAPA audit export manifests.
ALTER TYPE "CapaEvidenceScanStatus" ADD VALUE 'PURGING';
ALTER TYPE "CapaEvidenceScanStatus" ADD VALUE 'EXPIRED';
CREATE TYPE "CapaAuditExportFormat" AS ENUM ('JSON');

ALTER TABLE "capa_evidence_uploads"
  ADD COLUMN "purged_at" TIMESTAMPTZ(3);

CREATE TABLE "capa_audit_exports" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "exported_by_user_id" UUID NOT NULL,
  "format" "CapaAuditExportFormat" NOT NULL DEFAULT 'JSON',
  "schema_version" VARCHAR(30) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "record_count" INTEGER NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifest_hash" CHAR(64) NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "capa_audit_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_audit_exports_metadata_check" CHECK (
    char_length(btrim("schema_version")) BETWEEN 1 AND 30
    AND char_length(btrim("file_name")) BETWEEN 1 AND 255
    AND "record_count" >= 1
    AND "manifest_hash" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("manifest") = 'object'
  )
);

CREATE UNIQUE INDEX "capa_audit_exports_tenant_id_id_key"
  ON "capa_audit_exports"("tenant_id", "id");
CREATE INDEX "capa_audit_exports_capa_generated_idx"
  ON "capa_audit_exports"("tenant_id", "capa_id", "generated_at");

ALTER TABLE "capa_audit_exports"
  ADD CONSTRAINT "capa_audit_exports_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_audit_exports"
  ADD CONSTRAINT "capa_audit_exports_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_audit_exports"
  ADD CONSTRAINT "capa_audit_exports_exporter_fkey"
  FOREIGN KEY ("tenant_id", "exported_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.guard_capa_evidence_upload_mutation()
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
    OR OLD.scan_engine IS DISTINCT FROM NEW.scan_engine
    OR OLD.scan_result IS DISTINCT FROM NEW.scan_result
    OR OLD.scanned_at IS DISTINCT FROM NEW.scanned_at
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Managed CAPA evidence metadata is immutable after analysis.' USING ERRCODE = '55000';
  END IF;

  IF OLD.scan_status = 'AVAILABLE'
    AND NEW.scan_status = 'AVAILABLE'
    AND OLD.consumed_at IS NULL
    AND NEW.consumed_at IS NOT NULL
    AND OLD.purged_at IS NULL
    AND NEW.purged_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF OLD.scan_status = 'AVAILABLE'
    AND NEW.scan_status = 'PURGING'
    AND OLD.consumed_at IS NULL
    AND NEW.consumed_at IS NULL
    AND OLD.purged_at IS NULL
    AND NEW.purged_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF OLD.scan_status = 'PURGING'
    AND NEW.scan_status = 'EXPIRED'
    AND OLD.consumed_at IS NULL
    AND NEW.consumed_at IS NULL
    AND OLD.purged_at IS NULL
    AND NEW.purged_at IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Managed CAPA evidence has an invalid lifecycle transition.' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_capa_evidence_upload_mutation() FROM PUBLIC;

CREATE FUNCTION public.guard_capa_audit_export_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CAPA audit exports are immutable.' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_capa_audit_export_mutation() FROM PUBLIC;

CREATE TRIGGER capa_audit_export_mutation_guard
BEFORE UPDATE OR DELETE ON "capa_audit_exports"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_audit_export_mutation();

ALTER TABLE "capa_audit_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_audit_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_audit_exports"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "capa_audit_exports" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "capa_audit_exports" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid(), 'capas.export', 'Generate immutable CAPA audit export manifests.')
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF to_regrole('qualyra_runtime') IS NOT NULL THEN
    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT role.tenant_id, role.id, permission.id
    FROM "roles" role
    CROSS JOIN "permissions" permission
    WHERE permission.code = 'capas.export'
      AND role.name IN ('Administrator', 'QA Manager', 'Auditor')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
