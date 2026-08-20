CREATE TABLE "tenant_photo_evidence_usage" (
  "tenant_id" UUID NOT NULL,
  "used_bytes" BIGINT NOT NULL DEFAULT 0,
  "photo_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_photo_evidence_usage_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_photo_evidence_usage_bytes_check" CHECK ("used_bytes" >= 0),
  CONSTRAINT "tenant_photo_evidence_usage_count_check" CHECK ("photo_count" >= 0),
  CONSTRAINT "tenant_photo_evidence_usage_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "tenant_photo_evidence_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_photo_evidence_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_photo_evidence_usage"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "tenant_photo_evidence_usage" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "tenant_photo_evidence_usage" FROM qualyra_runtime;

CREATE FUNCTION public.increment_photo_evidence_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.tenant_photo_evidence_usage (
    tenant_id,
    used_bytes,
    photo_count,
    updated_at
  ) VALUES (
    NEW.tenant_id,
    NEW.size_bytes,
    1,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET used_bytes = public.tenant_photo_evidence_usage.used_bytes + EXCLUDED.used_bytes,
      photo_count = public.tenant_photo_evidence_usage.photo_count + 1,
      updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photo_evidence_usage_increment
  AFTER INSERT ON "photo_evidence"
  FOR EACH ROW EXECUTE FUNCTION public.increment_photo_evidence_usage();

REVOKE ALL ON FUNCTION public.increment_photo_evidence_usage() FROM PUBLIC;

DROP INDEX "photo_evidence_subject_created_idx";
CREATE INDEX "photo_evidence_subject_cursor_idx"
  ON "photo_evidence"(
    "tenant_id",
    "subject_type",
    "subject_id",
    "created_at" DESC,
    "id" DESC
  );
