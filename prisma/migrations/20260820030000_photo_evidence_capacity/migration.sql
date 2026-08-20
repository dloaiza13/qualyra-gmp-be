CREATE TYPE "PhotoEvidenceSubjectType" AS ENUM (
  'DOCUMENT',
  'TRAINING_ASSIGNMENT',
  'DEVIATION',
  'CAPA',
  'CHANGE_CONTROL',
  'AUDIT',
  'QUALITY_RISK',
  'SUPPLIER',
  'EQUIPMENT',
  'COMPLAINT',
  'RECALL',
  'PRODUCT_REVIEW'
);

CREATE TABLE "photo_evidence" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "subject_type" "PhotoEvidenceSubjectType" NOT NULL,
  "subject_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "storage_driver" VARCHAR(20) NOT NULL,
  "caption" VARCHAR(1000),
  "captured_at" TIMESTAMPTZ(3),
  "scan_engine" VARCHAR(100) NOT NULL,
  "scan_result" VARCHAR(200) NOT NULL,
  "scanned_at" TIMESTAMPTZ(3) NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "photo_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "photo_evidence_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "photo_evidence_content_type_check" CHECK ("content_type" LIKE 'image/%'),
  CONSTRAINT "photo_evidence_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "photo_evidence_storage_driver_check" CHECK ("storage_driver" IN ('LOCAL', 'S3'))
);

CREATE UNIQUE INDEX "photo_evidence_tenant_id_id_key"
  ON "photo_evidence"("tenant_id", "id");
CREATE UNIQUE INDEX "photo_evidence_subject_hash_key"
  ON "photo_evidence"("tenant_id", "subject_type", "subject_id", "sha256");
CREATE INDEX "photo_evidence_subject_created_idx"
  ON "photo_evidence"("tenant_id", "subject_type", "subject_id", "created_at");
CREATE INDEX "photo_evidence_tenant_created_idx"
  ON "photo_evidence"("tenant_id", "created_at");

ALTER TABLE "photo_evidence"
  ADD CONSTRAINT "photo_evidence_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "photo_evidence"
  ADD CONSTRAINT "photo_evidence_uploader_fkey"
  FOREIGN KEY ("tenant_id", "uploaded_by_user_id")
  REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.prevent_photo_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Controlled photographic evidence cannot be changed or deleted.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER photo_evidence_immutable
  BEFORE UPDATE OR DELETE ON "photo_evidence"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_photo_evidence_mutation();

REVOKE ALL ON FUNCTION public.prevent_photo_evidence_mutation() FROM PUBLIC;

ALTER TABLE "photo_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "photo_evidence"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "photo_evidence" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "photo_evidence" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'photo_evidence.read', 'View controlled photographic evidence.'),
  (gen_random_uuid(), 'photo_evidence.upload', 'Capture and upload controlled photographic evidence.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

DO $$
DECLARE tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    CROSS JOIN "permissions" permission
    WHERE role.tenant_id = tenant_record.id
      AND role.is_system = true
      AND role.name IN ('Administrator', 'QA Manager', 'Document Controller', 'Operator', 'Auditor')
      AND permission.code IN ('photo_evidence.read', 'photo_evidence.upload')
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
