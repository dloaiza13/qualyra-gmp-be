CREATE TYPE "ProductReviewStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FOLLOW_UP_REQUIRED', 'CANCELLED');
CREATE TYPE "ProductReviewDecisionType" AS ENUM ('APPROVE', 'REQUIRE_FOLLOW_UP');
CREATE TYPE "ProductReviewSignatureMeaning" AS ENUM ('REVIEW_ASSESSMENT', 'REVIEW_APPROVAL');
CREATE TYPE "ProductReviewAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

CREATE TABLE "product_review_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_review_sequences_pkey" PRIMARY KEY ("tenant_id", "year")
);

CREATE TABLE "product_quality_reviews" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(25) NOT NULL,
  "product_name" VARCHAR(200) NOT NULL,
  "product_code" VARCHAR(100) NOT NULL,
  "dosage_form" VARCHAR(120) NOT NULL,
  "strength" VARCHAR(120) NOT NULL,
  "market_authorization" VARCHAR(200) NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "target_completion_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "ProductReviewStatus" NOT NULL DEFAULT 'DRAFT',
  "approver_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "cancelled_by_user_id" UUID,
  "cancellation_reason" VARCHAR(1000),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_quality_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_quality_reviews_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "product_quality_reviews_independent_approver_check" CHECK ("approver_user_id" <> "created_by_user_id"),
  CONSTRAINT "product_quality_reviews_cancellation_check" CHECK (
    ("status" <> 'CANCELLED' AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL)
  )
);

CREATE TABLE "product_review_assessments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "product_review_id" UUID NOT NULL,
  "batches_manufactured" INTEGER NOT NULL,
  "batches_released" INTEGER NOT NULL,
  "batches_rejected" INTEGER NOT NULL,
  "out_of_specification_count" INTEGER NOT NULL,
  "stability_exception_count" INTEGER NOT NULL,
  "returned_unit_count" INTEGER NOT NULL,
  "manufacturing_summary" VARCHAR(5000) NOT NULL,
  "starting_materials_summary" VARCHAR(5000) NOT NULL,
  "critical_quality_attributes_summary" VARCHAR(5000) NOT NULL,
  "process_performance_summary" VARCHAR(5000) NOT NULL,
  "stability_summary" VARCHAR(5000) NOT NULL,
  "validation_summary" VARCHAR(5000) NOT NULL,
  "regulatory_summary" VARCHAR(5000) NOT NULL,
  "trend_analysis" VARCHAR(5000) NOT NULL,
  "benefit_risk_conclusion" VARCHAR(5000) NOT NULL,
  "recommendations" VARCHAR(5000) NOT NULL,
  "evidence_reference" VARCHAR(3000) NOT NULL,
  "continued_manufacture_recommended" BOOLEAN NOT NULL,
  "capa_required" BOOLEAN NOT NULL,
  "change_control_required" BOOLEAN NOT NULL,
  "trend_snapshot" JSONB NOT NULL,
  "prepared_by_user_id" UUID NOT NULL,
  "assessment_session_id" UUID NOT NULL,
  "meaning" "ProductReviewSignatureMeaning" NOT NULL DEFAULT 'REVIEW_ASSESSMENT',
  "authentication_method" "ProductReviewAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "prepared_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_review_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_review_assessments_counts_check" CHECK (
    "batches_manufactured" >= 0
    AND "batches_released" >= 0
    AND "batches_rejected" >= 0
    AND "out_of_specification_count" >= 0
    AND "stability_exception_count" >= 0
    AND "returned_unit_count" >= 0
    AND "batches_released" + "batches_rejected" <= "batches_manufactured"
  )
);

CREATE TABLE "product_review_decisions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "product_review_id" UUID NOT NULL,
  "decision" "ProductReviewDecisionType" NOT NULL,
  "rationale" VARCHAR(5000) NOT NULL,
  "follow_up_reference" VARCHAR(2000) NOT NULL,
  "next_review_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_by_user_id" UUID NOT NULL,
  "decision_session_id" UUID NOT NULL,
  "meaning" "ProductReviewSignatureMeaning" NOT NULL DEFAULT 'REVIEW_APPROVAL',
  "authentication_method" "ProductReviewAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_review_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_quality_reviews_tenant_id_id_key" ON "product_quality_reviews"("tenant_id", "id");
CREATE UNIQUE INDEX "product_quality_reviews_tenant_code_key" ON "product_quality_reviews"("tenant_id", "code");
CREATE UNIQUE INDEX "product_quality_reviews_product_period_key" ON "product_quality_reviews"("tenant_id", "product_code", "period_start", "period_end");
CREATE INDEX "product_quality_reviews_status_due_idx" ON "product_quality_reviews"("tenant_id", "status", "target_completion_at");
CREATE INDEX "product_quality_reviews_product_period_idx" ON "product_quality_reviews"("tenant_id", "product_code", "period_end");
CREATE UNIQUE INDEX "product_review_assessments_tenant_id_id_key" ON "product_review_assessments"("tenant_id", "id");
CREATE UNIQUE INDEX "product_review_assessments_review_key" ON "product_review_assessments"("tenant_id", "product_review_id");
CREATE UNIQUE INDEX "product_review_decisions_tenant_id_id_key" ON "product_review_decisions"("tenant_id", "id");
CREATE UNIQUE INDEX "product_review_decisions_review_key" ON "product_review_decisions"("tenant_id", "product_review_id");
CREATE INDEX "product_complaints_tenant_product_code_created_ci_idx" ON "product_complaints"("tenant_id", lower("product_code"), "created_at");
CREATE INDEX "product_recalls_tenant_product_code_created_ci_idx" ON "product_recalls"("tenant_id", lower("product_code"), "created_at");

ALTER TABLE "product_review_sequences" ADD CONSTRAINT "product_review_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_quality_reviews" ADD CONSTRAINT "product_quality_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_quality_reviews" ADD CONSTRAINT "product_quality_reviews_tenant_id_approver_user_id_fkey" FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_quality_reviews" ADD CONSTRAINT "product_quality_reviews_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_quality_reviews" ADD CONSTRAINT "product_quality_reviews_tenant_id_cancelled_by_user_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_assessments" ADD CONSTRAINT "product_review_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_assessments" ADD CONSTRAINT "product_review_assessments_tenant_id_product_review_id_fkey" FOREIGN KEY ("tenant_id", "product_review_id") REFERENCES "product_quality_reviews"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_assessments" ADD CONSTRAINT "product_review_assessment_signer_fkey" FOREIGN KEY ("tenant_id", "prepared_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_assessments" ADD CONSTRAINT "product_review_assessment_session_fkey" FOREIGN KEY ("tenant_id", "prepared_by_user_id", "assessment_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_decisions" ADD CONSTRAINT "product_review_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_decisions" ADD CONSTRAINT "product_review_decisions_tenant_id_product_review_id_fkey" FOREIGN KEY ("tenant_id", "product_review_id") REFERENCES "product_quality_reviews"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_decisions" ADD CONSTRAINT "product_review_decision_signer_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_review_decisions" ADD CONSTRAINT "product_review_decision_session_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id", "decision_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_product_quality_review_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.product_name, NEW.product_code, NEW.dosage_form,
         NEW.strength, NEW.market_authorization, NEW.period_start, NEW.period_end,
         NEW.target_completion_at, NEW.approver_user_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.product_name, OLD.product_code, OLD.dosage_form,
         OLD.strength, OLD.market_authorization, OLD.period_start, OLD.period_end,
         OLD.target_completion_at, OLD.approver_user_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The product review scope is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('APPROVED', 'FOLLOW_UP_REQUIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal product reviews are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL' AND EXISTS (
    SELECT 1 FROM public.product_review_assessments a
    WHERE a.tenant_id = NEW.tenant_id AND a.product_review_id = NEW.id
      AND a.prepared_by_user_id <> NEW.approver_user_id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'FOLLOW_UP_REQUIRED') AND EXISTS (
    SELECT 1 FROM public.product_review_decisions d
    WHERE d.tenant_id = NEW.tenant_id AND d.product_review_id = NEW.id
      AND d.decided_by_user_id = NEW.approver_user_id
      AND ((d.decision = 'APPROVE' AND NEW.status = 'APPROVED')
        OR (d.decision = 'REQUIRE_FOLLOW_UP' AND NEW.status = 'FOLLOW_UP_REQUIRED'))
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid product review lifecycle transition.' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.guard_product_review_assessment_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_quality_reviews r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.product_review_id
      AND r.status = 'DRAFT' AND r.approver_user_id <> NEW.prepared_by_user_id
  ) THEN RAISE EXCEPTION 'Assessment requires a draft with an independent approver.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_product_review_decision_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_quality_reviews r
    JOIN public.product_review_assessments a ON a.tenant_id = r.tenant_id AND a.product_review_id = r.id
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.product_review_id
      AND r.status = 'PENDING_APPROVAL' AND r.approver_user_id = NEW.decided_by_user_id
      AND a.prepared_by_user_id <> NEW.decided_by_user_id
  ) THEN RAISE EXCEPTION 'Only the independent assigned approver may sign this product review.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_product_review_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Controlled product review records cannot be changed or deleted.' USING ERRCODE = '55000'; END;
$$;

CREATE TRIGGER product_quality_reviews_mutation_guard BEFORE UPDATE ON "product_quality_reviews" FOR EACH ROW EXECUTE FUNCTION public.guard_product_quality_review_mutation();
CREATE TRIGGER product_quality_reviews_delete_guard BEFORE DELETE ON "product_quality_reviews" FOR EACH ROW EXECUTE FUNCTION public.prevent_product_review_record_mutation();
CREATE TRIGGER product_review_assessments_insert_guard BEFORE INSERT ON "product_review_assessments" FOR EACH ROW EXECUTE FUNCTION public.guard_product_review_assessment_insert();
CREATE TRIGGER product_review_assessments_immutable BEFORE UPDATE OR DELETE ON "product_review_assessments" FOR EACH ROW EXECUTE FUNCTION public.prevent_product_review_record_mutation();
CREATE TRIGGER product_review_decisions_insert_guard BEFORE INSERT ON "product_review_decisions" FOR EACH ROW EXECUTE FUNCTION public.guard_product_review_decision_insert();
CREATE TRIGGER product_review_decisions_immutable BEFORE UPDATE OR DELETE ON "product_review_decisions" FOR EACH ROW EXECUTE FUNCTION public.prevent_product_review_record_mutation();

REVOKE ALL ON FUNCTION public.guard_product_quality_review_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_product_review_assessment_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_product_review_decision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_product_review_record_mutation() FROM PUBLIC;

ALTER TABLE "product_review_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_review_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_quality_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_quality_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_review_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_review_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_review_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_review_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_review_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "product_quality_reviews" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "product_review_assessments" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "product_review_decisions" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "product_review_sequences", "product_quality_reviews" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "product_review_assessments", "product_review_decisions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "product_review_sequences", "product_quality_reviews", "product_review_assessments", "product_review_decisions" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "product_review_assessments", "product_review_decisions" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'product_reviews.read', 'View product quality reviews and trend snapshots.'),
  (gen_random_uuid(), 'product_reviews.create', 'Create controlled product quality review scopes.'),
  (gen_random_uuid(), 'product_reviews.prepare', 'Prepare and sign product quality review assessments.'),
  (gen_random_uuid(), 'product_reviews.approve', 'Independently approve product quality reviews.'),
  (gen_random_uuid(), 'product_reviews.cancel', 'Cancel invalid product review scopes before assessment.')
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
      ('Administrator', 'product_reviews.read'), ('Administrator', 'product_reviews.create'), ('Administrator', 'product_reviews.prepare'), ('Administrator', 'product_reviews.approve'), ('Administrator', 'product_reviews.cancel'),
      ('QA Manager', 'product_reviews.read'), ('QA Manager', 'product_reviews.create'), ('QA Manager', 'product_reviews.prepare'), ('QA Manager', 'product_reviews.approve'), ('QA Manager', 'product_reviews.cancel'),
      ('Document Controller', 'product_reviews.read'), ('Document Controller', 'product_reviews.create'),
      ('Operator', 'product_reviews.read'), ('Operator', 'product_reviews.prepare'),
      ('Auditor', 'product_reviews.read'), ('Auditor', 'product_reviews.approve')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
