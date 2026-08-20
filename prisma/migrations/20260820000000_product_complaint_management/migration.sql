CREATE TYPE "ComplaintSource" AS ENUM ('CUSTOMER', 'DISTRIBUTOR', 'HEALTH_AUTHORITY', 'INTERNAL', 'OTHER');
CREATE TYPE "ComplaintCategory" AS ENUM ('PRODUCT_QUALITY', 'PACKAGING', 'LABELING', 'DELIVERY', 'COUNTERFEIT_SUSPECTED', 'OTHER');
CREATE TYPE "ComplaintStatus" AS ENUM ('REPORTED', 'UNDER_INVESTIGATION', 'PENDING_REVIEW', 'CLOSED', 'CANCELLED');
CREATE TYPE "ComplaintSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ComplaintRegulatoryAssessment" AS ENUM ('UNDER_EVALUATION', 'NOT_REPORTABLE', 'REPORTABLE');
CREATE TYPE "ComplaintDisposition" AS ENUM ('SUBSTANTIATED', 'UNSUBSTANTIATED', 'INCONCLUSIVE');
CREATE TYPE "ComplaintSignatureMeaning" AS ENUM ('INVESTIGATION_COMPLETION', 'COMPLAINT_DECISION');
CREATE TYPE "ComplaintAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

CREATE TABLE "complaint_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "complaint_sequences_pkey" PRIMARY KEY ("tenant_id", "year")
);

CREATE TABLE "product_complaints" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(25) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "source" "ComplaintSource" NOT NULL,
  "category" "ComplaintCategory" NOT NULL,
  "product_name" VARCHAR(200) NOT NULL,
  "product_code" VARCHAR(100) NOT NULL,
  "lot_number" VARCHAR(100) NOT NULL,
  "expiry_date" DATE,
  "country_code" CHAR(2) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "reporter_name" VARCHAR(200),
  "reporter_contact" VARCHAR(320),
  "evidence_reference" VARCHAR(2000) NOT NULL,
  "potential_safety_event" BOOLEAN NOT NULL DEFAULT false,
  "status" "ComplaintStatus" NOT NULL DEFAULT 'REPORTED',
  "severity" "ComplaintSeverity",
  "regulatory_assessment" "ComplaintRegulatoryAssessment",
  "recall_assessment_required" BOOLEAN,
  "immediate_actions" VARCHAR(3000),
  "target_close_at" TIMESTAMPTZ(3),
  "investigator_user_id" UUID,
  "reviewer_user_id" UUID,
  "triaged_by_user_id" UUID,
  "triaged_at" TIMESTAMPTZ(3),
  "reported_by_user_id" UUID NOT NULL,
  "cancelled_by_user_id" UUID,
  "cancellation_reason" VARCHAR(1000),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_complaints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_complaints_triage_tuple_check" CHECK (
    ("status" = 'REPORTED' AND "severity" IS NULL AND "regulatory_assessment" IS NULL
      AND "recall_assessment_required" IS NULL AND "immediate_actions" IS NULL
      AND "target_close_at" IS NULL AND "investigator_user_id" IS NULL
      AND "reviewer_user_id" IS NULL AND "triaged_by_user_id" IS NULL AND "triaged_at" IS NULL)
    OR ("status" IN ('UNDER_INVESTIGATION', 'PENDING_REVIEW', 'CLOSED')
      AND "severity" IS NOT NULL AND "regulatory_assessment" IS NOT NULL
      AND "recall_assessment_required" IS NOT NULL AND "immediate_actions" IS NOT NULL
      AND "target_close_at" IS NOT NULL AND "investigator_user_id" IS NOT NULL
      AND "reviewer_user_id" IS NOT NULL AND "triaged_by_user_id" IS NOT NULL AND "triaged_at" IS NOT NULL)
    OR "status" = 'CANCELLED'
  ),
  CONSTRAINT "product_complaints_independence_check" CHECK (
    "investigator_user_id" IS NULL OR "reviewer_user_id" IS NULL
    OR "investigator_user_id" <> "reviewer_user_id"
  ),
  CONSTRAINT "product_complaints_cancellation_tuple_check" CHECK (
    ("status" <> 'CANCELLED' AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL)
  )
);

CREATE TABLE "complaint_investigations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "complaint_id" UUID NOT NULL,
  "investigation_summary" VARCHAR(5000) NOT NULL,
  "root_cause" VARCHAR(3000) NOT NULL,
  "batch_impact" VARCHAR(3000) NOT NULL,
  "distributed_product_impact" VARCHAR(3000) NOT NULL,
  "sample_evaluation" VARCHAR(3000) NOT NULL,
  "evidence_reference" VARCHAR(3000) NOT NULL,
  "recommended_disposition" "ComplaintDisposition" NOT NULL,
  "response_recommendation" VARCHAR(3000) NOT NULL,
  "deviation_id" UUID,
  "capa_id" UUID,
  "supplier_id" UUID,
  "quality_risk_id" UUID,
  "change_control_id" UUID,
  "investigated_by_user_id" UUID NOT NULL,
  "investigation_session_id" UUID NOT NULL,
  "meaning" "ComplaintSignatureMeaning" NOT NULL DEFAULT 'INVESTIGATION_COMPLETION',
  "authentication_method" "ComplaintAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "investigated_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "complaint_investigations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complaint_decisions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "complaint_id" UUID NOT NULL,
  "disposition" "ComplaintDisposition" NOT NULL,
  "rationale" VARCHAR(3000) NOT NULL,
  "final_response_reference" VARCHAR(2000) NOT NULL,
  "regulatory_action" VARCHAR(3000) NOT NULL,
  "recall_action_required" BOOLEAN NOT NULL,
  "decided_by_user_id" UUID NOT NULL,
  "decision_session_id" UUID NOT NULL,
  "meaning" "ComplaintSignatureMeaning" NOT NULL DEFAULT 'COMPLAINT_DECISION',
  "authentication_method" "ComplaintAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "complaint_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_complaints_status_due_idx" ON "product_complaints"("tenant_id", "status", "target_close_at");
CREATE INDEX "product_complaints_product_lot_idx" ON "product_complaints"("tenant_id", "product_code", "lot_number");
CREATE INDEX "product_complaints_severity_idx" ON "product_complaints"("tenant_id", "severity", "created_at");
CREATE UNIQUE INDEX "product_complaints_tenant_id_id_key" ON "product_complaints"("tenant_id", "id");
CREATE UNIQUE INDEX "product_complaints_tenant_code_key" ON "product_complaints"("tenant_id", "code");
CREATE UNIQUE INDEX "complaint_investigations_tenant_id_id_key" ON "complaint_investigations"("tenant_id", "id");
CREATE UNIQUE INDEX "complaint_investigations_complaint_key" ON "complaint_investigations"("tenant_id", "complaint_id");
CREATE UNIQUE INDEX "complaint_decisions_tenant_id_id_key" ON "complaint_decisions"("tenant_id", "id");
CREATE UNIQUE INDEX "complaint_decisions_complaint_key" ON "complaint_decisions"("tenant_id", "complaint_id");

ALTER TABLE "complaint_sequences" ADD CONSTRAINT "complaint_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_reported_by_user_id_fkey" FOREIGN KEY ("tenant_id", "reported_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_investigator_user_id_fkey" FOREIGN KEY ("tenant_id", "investigator_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_reviewer_user_id_fkey" FOREIGN KEY ("tenant_id", "reviewer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_triaged_by_user_id_fkey" FOREIGN KEY ("tenant_id", "triaged_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_complaints" ADD CONSTRAINT "product_complaints_tenant_id_cancelled_by_user_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_complaint_id_fkey" FOREIGN KEY ("tenant_id", "complaint_id") REFERENCES "product_complaints"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigation_signer_fkey" FOREIGN KEY ("tenant_id", "investigated_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigation_session_fkey" FOREIGN KEY ("tenant_id", "investigated_by_user_id", "investigation_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_deviation_id_fkey" FOREIGN KEY ("tenant_id", "deviation_id") REFERENCES "deviations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_capa_id_fkey" FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_quality_risk_id_fkey" FOREIGN KEY ("tenant_id", "quality_risk_id") REFERENCES "quality_risk_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_investigations" ADD CONSTRAINT "complaint_investigations_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_decisions" ADD CONSTRAINT "complaint_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_decisions" ADD CONSTRAINT "complaint_decisions_tenant_id_complaint_id_fkey" FOREIGN KEY ("tenant_id", "complaint_id") REFERENCES "product_complaints"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_decisions" ADD CONSTRAINT "complaint_decision_signer_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_decisions" ADD CONSTRAINT "complaint_decision_session_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id", "decision_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_product_complaint_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.description, NEW.source, NEW.category,
         NEW.product_name, NEW.product_code, NEW.lot_number, NEW.expiry_date,
         NEW.country_code, NEW.received_at, NEW.reporter_name, NEW.reporter_contact,
         NEW.evidence_reference, NEW.potential_safety_event, NEW.reported_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.description, OLD.source, OLD.category,
         OLD.product_name, OLD.product_code, OLD.lot_number, OLD.expiry_date,
         OLD.country_code, OLD.received_at, OLD.reporter_name, OLD.reporter_contact,
         OLD.evidence_reference, OLD.potential_safety_event, OLD.reported_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The complaint intake record is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal complaints are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REPORTED' AND NEW.status = 'UNDER_INVESTIGATION' THEN
    IF NEW.investigator_user_id = NEW.reviewer_user_id OR NEW.target_close_at <= NEW.triaged_at THEN
      RAISE EXCEPTION 'Complaint triage requires independent users and a future target date.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'UNDER_INVESTIGATION' AND NEW.status = 'PENDING_REVIEW' AND EXISTS (
    SELECT 1 FROM public.complaint_investigations i
    WHERE i.tenant_id = NEW.tenant_id AND i.complaint_id = NEW.id
      AND i.investigated_by_user_id = NEW.investigator_user_id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'PENDING_REVIEW' AND NEW.status = 'CLOSED' AND EXISTS (
    SELECT 1 FROM public.complaint_decisions d
    WHERE d.tenant_id = NEW.tenant_id AND d.complaint_id = NEW.id
      AND d.decided_by_user_id = NEW.reviewer_user_id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'REPORTED' AND NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid complaint lifecycle transition.' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.guard_complaint_investigation_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_complaints c
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.complaint_id
      AND c.status = 'UNDER_INVESTIGATION' AND c.investigator_user_id = NEW.investigated_by_user_id
      AND c.reviewer_user_id <> NEW.investigated_by_user_id
  ) THEN RAISE EXCEPTION 'Only the assigned investigator may sign this investigation.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_complaint_decision_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_complaints c
    JOIN public.complaint_investigations i ON i.tenant_id = c.tenant_id AND i.complaint_id = c.id
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.complaint_id
      AND c.status = 'PENDING_REVIEW' AND c.reviewer_user_id = NEW.decided_by_user_id
      AND i.investigated_by_user_id <> NEW.decided_by_user_id
  ) THEN RAISE EXCEPTION 'Only the independent reviewer may sign this complaint decision.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_complaint_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Signed complaint records cannot be changed or deleted.' USING ERRCODE = '55000'; END;
$$;

CREATE TRIGGER product_complaints_mutation_guard BEFORE UPDATE ON "product_complaints" FOR EACH ROW EXECUTE FUNCTION public.guard_product_complaint_mutation();
CREATE TRIGGER product_complaints_delete_guard BEFORE DELETE ON "product_complaints" FOR EACH ROW EXECUTE FUNCTION public.prevent_complaint_record_mutation();
CREATE TRIGGER complaint_investigations_insert_guard BEFORE INSERT ON "complaint_investigations" FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_investigation_insert();
CREATE TRIGGER complaint_investigations_immutable BEFORE UPDATE OR DELETE ON "complaint_investigations" FOR EACH ROW EXECUTE FUNCTION public.prevent_complaint_record_mutation();
CREATE TRIGGER complaint_decisions_insert_guard BEFORE INSERT ON "complaint_decisions" FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_decision_insert();
CREATE TRIGGER complaint_decisions_immutable BEFORE UPDATE OR DELETE ON "complaint_decisions" FOR EACH ROW EXECUTE FUNCTION public.prevent_complaint_record_mutation();

REVOKE ALL ON FUNCTION public.guard_product_complaint_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_complaint_investigation_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_complaint_decision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_complaint_record_mutation() FROM PUBLIC;

ALTER TABLE "complaint_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_complaints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_complaints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "complaint_investigations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint_investigations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "complaint_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "complaint_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "product_complaints" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "complaint_investigations" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "complaint_decisions" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "complaint_sequences", "product_complaints" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "complaint_investigations", "complaint_decisions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "complaint_sequences", "product_complaints", "complaint_investigations", "complaint_decisions" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "complaint_investigations", "complaint_decisions" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'complaints.read', 'View product quality complaints and signed evidence.'),
  (gen_random_uuid(), 'complaints.create', 'Report immutable product quality complaints.'),
  (gen_random_uuid(), 'complaints.triage', 'Assess complaint criticality and assign independent owners.'),
  (gen_random_uuid(), 'complaints.investigate', 'Complete and sign assigned complaint investigations.'),
  (gen_random_uuid(), 'complaints.review', 'Independently decide and close investigated complaints.'),
  (gen_random_uuid(), 'complaints.cancel', 'Cancel invalid complaints before triage.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

DO $$
DECLARE tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    JOIN (VALUES
      ('Administrator', 'complaints.read'), ('Administrator', 'complaints.create'), ('Administrator', 'complaints.triage'), ('Administrator', 'complaints.investigate'), ('Administrator', 'complaints.review'), ('Administrator', 'complaints.cancel'),
      ('QA Manager', 'complaints.read'), ('QA Manager', 'complaints.create'), ('QA Manager', 'complaints.triage'), ('QA Manager', 'complaints.investigate'), ('QA Manager', 'complaints.review'), ('QA Manager', 'complaints.cancel'),
      ('Document Controller', 'complaints.read'), ('Document Controller', 'complaints.create'),
      ('Operator', 'complaints.read'), ('Operator', 'complaints.create'), ('Operator', 'complaints.investigate'),
      ('Auditor', 'complaints.read'), ('Auditor', 'complaints.review')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
