-- Keep lifecycle and manifest identity constraints independent of application code.
ALTER TABLE "capa_evidence_uploads"
  ADD CONSTRAINT "capa_evidence_uploads_retention_state_check" CHECK (
    ("scan_status" = 'AVAILABLE' AND "purged_at" IS NULL)
    OR ("scan_status" = 'PURGING' AND "consumed_at" IS NULL AND "purged_at" IS NULL)
    OR ("scan_status" = 'EXPIRED' AND "consumed_at" IS NULL AND "purged_at" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.guard_capa_evidence_upload_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scan_status <> 'AVAILABLE'
    OR NEW.consumed_at IS NOT NULL
    OR NEW.purged_at IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.capa_actions action
      WHERE action.tenant_id = NEW.tenant_id
        AND action.capa_id = NEW.capa_id
        AND action.id = NEW.action_id
        AND action.assigned_to_user_id = NEW.uploaded_by_user_id
        AND action.status = 'OPEN'
    )
  THEN
    RAISE EXCEPTION 'Managed evidence may only be staged by the assignee for an open CAPA action.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_capa_evidence_upload_insert() FROM PUBLIC;

ALTER TABLE "capa_audit_exports"
  ADD CONSTRAINT "capa_audit_exports_manifest_identity_check" CHECK (
    "manifest" #>> '{export,id}' = "id"::text
    AND "manifest" #>> '{tenant,id}' = "tenant_id"::text
    AND "manifest" #>> '{capa,id}' = "capa_id"::text
    AND "manifest" #>> '{integrity,sha256}' = "manifest_hash"
    AND "manifest" ->> 'schemaVersion' = "schema_version"
  );
