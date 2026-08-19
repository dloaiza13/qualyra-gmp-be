-- Quality Risk Management (ICH Q9 aligned FMEA workflow)
CREATE TYPE "QualityRiskCategory" AS ENUM ('PRODUCT', 'PROCESS', 'EQUIPMENT', 'COMPUTERIZED_SYSTEM', 'SUPPLIER', 'FACILITY', 'OTHER');
CREATE TYPE "QualityRiskMethod" AS ENUM ('FMEA');
CREATE TYPE "QualityRiskStatus" AS ENUM ('OPEN', 'PENDING_REVIEW', 'CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED', 'CANCELLED');
CREATE TYPE "QualityRiskItemStatus" AS ENUM ('OPEN', 'COMPLETED');
CREATE TYPE "QualityRiskReviewDecision" AS ENUM ('ACCEPT', 'NOT_ACCEPTABLE');
CREATE TYPE "QualityRiskSignatureMeaning" AS ENUM ('MITIGATION_COMPLETION', 'RESIDUAL_RISK_REVIEW');
CREATE TYPE "QualityRiskAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

CREATE TABLE "quality_risk_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_sequences_pkey" PRIMARY KEY ("tenant_id", "year")
);

CREATE TABLE "quality_risk_assessments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(25) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "category" "QualityRiskCategory" NOT NULL,
  "method" "QualityRiskMethod" NOT NULL DEFAULT 'FMEA',
  "process_area" VARCHAR(120) NOT NULL,
  "scope" VARCHAR(3000) NOT NULL,
  "risk_statement" VARCHAR(3000) NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "target_review_at" TIMESTAMPTZ(3) NOT NULL,
  "deviation_id" UUID,
  "capa_id" UUID,
  "change_control_id" UUID,
  "audit_id" UUID,
  "status" "QualityRiskStatus" NOT NULL DEFAULT 'OPEN',
  "cancelled_by_user_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risks_independent_reviewer_check" CHECK (reviewer_user_id <> owner_user_id AND reviewer_user_id <> created_by_user_id),
  CONSTRAINT "quality_risks_cancellation_check" CHECK (
    (status = 'CANCELLED' AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
    OR (status <> 'CANCELLED' AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  )
);

CREATE TABLE "quality_risk_items" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "failure_mode" VARCHAR(500) NOT NULL,
  "cause" VARCHAR(2000) NOT NULL,
  "effect" VARCHAR(2000) NOT NULL,
  "current_controls" VARCHAR(3000) NOT NULL,
  "initial_severity" INTEGER NOT NULL,
  "initial_probability" INTEGER NOT NULL,
  "initial_detectability" INTEGER NOT NULL,
  "initial_rpn" INTEGER NOT NULL,
  "mitigation_plan" VARCHAR(3000) NOT NULL,
  "assigned_to_user_id" UUID NOT NULL,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "QualityRiskItemStatus" NOT NULL DEFAULT 'OPEN',
  "completion_evidence" VARCHAR(5000),
  "residual_severity" INTEGER,
  "residual_probability" INTEGER,
  "residual_detectability" INTEGER,
  "residual_rpn" INTEGER,
  "completed_by_user_id" UUID,
  "completion_session_id" UUID,
  "meaning" "QualityRiskSignatureMeaning",
  "authentication_method" "QualityRiskAuthenticationMethod",
  "completed_at" TIMESTAMPTZ(3),
  "record_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risk_items_sequence_check" CHECK (sequence_number > 0),
  CONSTRAINT "quality_risk_items_initial_scores_check" CHECK (
    initial_severity BETWEEN 1 AND 5 AND initial_probability BETWEEN 1 AND 5
    AND initial_detectability BETWEEN 1 AND 5
    AND initial_rpn = initial_severity * initial_probability * initial_detectability
  ),
  CONSTRAINT "quality_risk_items_completion_check" CHECK (
    (status = 'OPEN' AND completion_evidence IS NULL AND residual_severity IS NULL
      AND residual_probability IS NULL AND residual_detectability IS NULL AND residual_rpn IS NULL
      AND completed_by_user_id IS NULL AND completion_session_id IS NULL AND meaning IS NULL
      AND authentication_method IS NULL AND completed_at IS NULL AND record_hash IS NULL)
    OR
    (status = 'COMPLETED' AND completion_evidence IS NOT NULL
      AND residual_severity BETWEEN 1 AND 5 AND residual_probability BETWEEN 1 AND 5
      AND residual_detectability BETWEEN 1 AND 5
      AND residual_rpn = residual_severity * residual_probability * residual_detectability
      AND completed_by_user_id = assigned_to_user_id AND completion_session_id IS NOT NULL
      AND meaning = 'MITIGATION_COMPLETION' AND authentication_method = 'PASSWORD_REAUTHENTICATION'
      AND completed_at IS NOT NULL AND record_hash IS NOT NULL)
  )
);

CREATE TABLE "quality_risk_reviews" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "risk_id" UUID NOT NULL,
  "decision" "QualityRiskReviewDecision" NOT NULL,
  "rationale" VARCHAR(3000) NOT NULL,
  "reviewed_by_user_id" UUID NOT NULL,
  "review_session_id" UUID NOT NULL,
  "meaning" "QualityRiskSignatureMeaning" NOT NULL DEFAULT 'RESIDUAL_RISK_REVIEW',
  "authentication_method" "QualityRiskAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quality_risks_tenant_id_id_key" ON "quality_risk_assessments" ("tenant_id", "id");
CREATE UNIQUE INDEX "quality_risks_tenant_id_code_key" ON "quality_risk_assessments" ("tenant_id", "code");
CREATE INDEX "quality_risks_status_review_idx" ON "quality_risk_assessments" ("tenant_id", "status", "target_review_at");
CREATE INDEX "quality_risks_category_created_idx" ON "quality_risk_assessments" ("tenant_id", "category", "created_at");
CREATE UNIQUE INDEX "quality_risk_items_tenant_id_id_key" ON "quality_risk_items" ("tenant_id", "id");
CREATE UNIQUE INDEX "quality_risk_items_risk_sequence_key" ON "quality_risk_items" ("tenant_id", "risk_id", "sequence_number");
CREATE INDEX "quality_risk_items_assignee_status_due_idx" ON "quality_risk_items" ("tenant_id", "assigned_to_user_id", "status", "due_at");
CREATE UNIQUE INDEX "quality_risk_reviews_tenant_id_id_key" ON "quality_risk_reviews" ("tenant_id", "id");
CREATE UNIQUE INDEX "quality_risk_reviews_risk_key" ON "quality_risk_reviews" ("tenant_id", "risk_id");

ALTER TABLE "quality_risk_sequences" ADD CONSTRAINT "quality_risk_sequences_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_owner_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_reviewer_fkey" FOREIGN KEY ("tenant_id", "reviewer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_canceller_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_deviation_fkey" FOREIGN KEY ("tenant_id", "deviation_id") REFERENCES "deviations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_capa_fkey" FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_change_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_assessments" ADD CONSTRAINT "quality_risks_audit_fkey" FOREIGN KEY ("tenant_id", "audit_id") REFERENCES "audits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_items" ADD CONSTRAINT "quality_risk_items_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_items" ADD CONSTRAINT "quality_risk_items_risk_fkey" FOREIGN KEY ("tenant_id", "risk_id") REFERENCES "quality_risk_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_items" ADD CONSTRAINT "quality_risk_items_assignee_fkey" FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_items" ADD CONSTRAINT "quality_risk_items_completer_fkey" FOREIGN KEY ("tenant_id", "completed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_items" ADD CONSTRAINT "quality_risk_items_session_fkey" FOREIGN KEY ("tenant_id", "completed_by_user_id", "completion_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reviews" ADD CONSTRAINT "quality_risk_reviews_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reviews" ADD CONSTRAINT "quality_risk_reviews_risk_fkey" FOREIGN KEY ("tenant_id", "risk_id") REFERENCES "quality_risk_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reviews" ADD CONSTRAINT "quality_risk_reviews_reviewer_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quality_risk_reviews" ADD CONSTRAINT "quality_risk_reviews_session_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id", "review_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_quality_risk_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.category, NEW.method, NEW.process_area,
         NEW.scope, NEW.risk_statement, NEW.owner_user_id, NEW.reviewer_user_id,
         NEW.created_by_user_id, NEW.target_review_at, NEW.deviation_id, NEW.capa_id,
         NEW.change_control_id, NEW.audit_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.category, OLD.method, OLD.process_area,
         OLD.scope, OLD.risk_statement, OLD.owner_user_id, OLD.reviewer_user_id,
         OLD.created_by_user_id, OLD.target_review_at, OLD.deviation_id, OLD.capa_id,
         OLD.change_control_id, OLD.audit_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The approved quality risk plan is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'OPEN' AND NEW.status IN ('PENDING_REVIEW', 'CANCELLED')) OR
    (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid quality risk lifecycle transition.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'PENDING_REVIEW' AND EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.id AND item.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Every mitigation must be completed before residual risk review.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'PENDING_REVIEW' AND NOT EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A quality risk assessment requires at least one FMEA item.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED') AND NOT EXISTS (
    SELECT 1 FROM public.quality_risk_reviews review
    WHERE review.tenant_id = NEW.tenant_id AND review.risk_id = NEW.id
      AND ((NEW.status = 'CLOSED' AND review.decision = 'ACCEPT')
        OR (NEW.status = 'RESIDUAL_RISK_NOT_ACCEPTED' AND review.decision = 'NOT_ACCEPTABLE'))
  ) THEN
    RAISE EXCEPTION 'A matching signed residual risk review is required.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_quality_risk_item_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.quality_risk_assessments risk
      WHERE risk.tenant_id = NEW.tenant_id AND risk.id = NEW.risk_id AND risk.status = 'OPEN'
    ) THEN
      RAISE EXCEPTION 'FMEA items may only be added to an open assessment.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.risk_id, NEW.sequence_number, NEW.failure_mode, NEW.cause,
         NEW.effect, NEW.current_controls, NEW.initial_severity, NEW.initial_probability,
         NEW.initial_detectability, NEW.initial_rpn, NEW.mitigation_plan,
         NEW.assigned_to_user_id, NEW.due_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.risk_id, OLD.sequence_number, OLD.failure_mode, OLD.cause,
         OLD.effect, OLD.current_controls, OLD.initial_severity, OLD.initial_probability,
         OLD.initial_detectability, OLD.initial_rpn, OLD.mitigation_plan,
         OLD.assigned_to_user_id, OLD.due_at, OLD.created_at)
     OR OLD.status <> 'OPEN' OR NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'FMEA definitions and signed mitigations are immutable.' USING ERRCODE = '55000';
  END IF;
  IF NEW.completed_by_user_id <> NEW.assigned_to_user_id OR NOT EXISTS (
    SELECT 1 FROM public.quality_risk_assessments risk
    WHERE risk.tenant_id = NEW.tenant_id AND risk.id = NEW.risk_id AND risk.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Only the assigned user may sign mitigation completion.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_quality_risk_review_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.quality_risk_assessments risk
    WHERE risk.tenant_id = NEW.tenant_id AND risk.id = NEW.risk_id
      AND risk.status = 'PENDING_REVIEW' AND risk.reviewer_user_id = NEW.reviewed_by_user_id
      AND risk.owner_user_id <> NEW.reviewed_by_user_id AND risk.created_by_user_id <> NEW.reviewed_by_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.risk_id
      AND item.completed_by_user_id = NEW.reviewed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the assigned independent reviewer may sign the residual risk review.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_quality_risk_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Signed quality risk records cannot be changed or deleted.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER quality_risks_transition_guard BEFORE UPDATE ON "quality_risk_assessments" FOR EACH ROW EXECUTE FUNCTION public.guard_quality_risk_transition();
CREATE TRIGGER quality_risk_items_mutation_guard BEFORE INSERT OR UPDATE ON "quality_risk_items" FOR EACH ROW EXECUTE FUNCTION public.guard_quality_risk_item_mutation();
CREATE TRIGGER quality_risk_reviews_insert_guard BEFORE INSERT ON "quality_risk_reviews" FOR EACH ROW EXECUTE FUNCTION public.guard_quality_risk_review_insert();
CREATE TRIGGER quality_risk_reviews_immutable BEFORE UPDATE OR DELETE ON "quality_risk_reviews" FOR EACH ROW EXECUTE FUNCTION public.prevent_quality_risk_record_mutation();
CREATE TRIGGER quality_risk_items_delete_guard BEFORE DELETE ON "quality_risk_items" FOR EACH ROW EXECUTE FUNCTION public.prevent_quality_risk_record_mutation();
CREATE TRIGGER quality_risks_delete_guard BEFORE DELETE ON "quality_risk_assessments" FOR EACH ROW EXECUTE FUNCTION public.prevent_quality_risk_record_mutation();

REVOKE ALL ON FUNCTION public.guard_quality_risk_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_quality_risk_item_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_quality_risk_review_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_quality_risk_record_mutation() FROM PUBLIC;

ALTER TABLE "quality_risk_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_risk_reviews" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "quality_risk_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "quality_risk_assessments" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "quality_risk_items" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "quality_risk_reviews" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "quality_risk_sequences", "quality_risk_assessments", "quality_risk_items" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "quality_risk_reviews" TO qualyra_runtime;
REVOKE DELETE ON TABLE "quality_risk_sequences", "quality_risk_assessments", "quality_risk_items", "quality_risk_reviews" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "quality_risk_reviews" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'risks.read', 'View quality risk assessments and signed FMEA evidence.'),
  (gen_random_uuid(), 'risks.create', 'Create controlled quality risk assessments.'),
  (gen_random_uuid(), 'risks.mitigate', 'Complete and sign assigned risk mitigations.'),
  (gen_random_uuid(), 'risks.review', 'Independently review and sign residual risk decisions.')
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
      ('Administrator', 'risks.read'), ('Administrator', 'risks.create'), ('Administrator', 'risks.mitigate'), ('Administrator', 'risks.review'),
      ('QA Manager', 'risks.read'), ('QA Manager', 'risks.create'), ('QA Manager', 'risks.mitigate'), ('QA Manager', 'risks.review'),
      ('Document Controller', 'risks.read'), ('Document Controller', 'risks.create'), ('Document Controller', 'risks.mitigate'),
      ('Operator', 'risks.read'), ('Operator', 'risks.mitigate'),
      ('Auditor', 'risks.read'), ('Auditor', 'risks.review')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
