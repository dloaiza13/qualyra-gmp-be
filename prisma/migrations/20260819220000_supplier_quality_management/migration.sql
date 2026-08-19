-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('RAW_MATERIAL', 'PACKAGING_MATERIAL', 'SERVICE', 'CONTRACT_MANUFACTURER', 'LABORATORY', 'LOGISTICS', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('PENDING_QUALIFICATION', 'APPROVED', 'CONDITIONALLY_APPROVED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "SupplierQualificationType" AS ENUM ('INITIAL', 'PERIODIC', 'EVENT_DRIVEN');

-- CreateEnum
CREATE TYPE "SupplierQualificationStatus" AS ENUM ('PENDING_DECISION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SupplierRecommendation" AS ENUM ('APPROVE', 'CONDITIONALLY_APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "SupplierQualificationDecisionType" AS ENUM ('APPROVE', 'CONDITIONALLY_APPROVE', 'DISQUALIFY');

-- CreateEnum
CREATE TYPE "SupplierScarSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupplierScarStatus" AS ENUM ('OPEN', 'RESPONSE_SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupplierScarResponseDecision" AS ENUM ('ACCEPT', 'REQUEST_REVISION');

-- CreateEnum
CREATE TYPE "SupplierSignatureMeaning" AS ENUM ('QUALIFICATION_ASSESSMENT', 'QUALIFICATION_DECISION', 'SCAR_RESPONSE', 'SCAR_RESPONSE_REVIEW');

-- CreateEnum
CREATE TYPE "SupplierAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

-- CreateTable
CREATE TABLE "supplier_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "registration_number" VARCHAR(100) NOT NULL,
    "category" "SupplierCategory" NOT NULL,
    "criticality" "SupplierCriticality" NOT NULL,
    "scope_of_supply" VARCHAR(3000) NOT NULL,
    "manufacturing_site" VARCHAR(500) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "contact_name" VARCHAR(200) NOT NULL,
    "contact_email" VARCHAR(320) NOT NULL,
    "quality_owner_user_id" UUID NOT NULL,
    "approver_user_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING_QUALIFICATION',
    "next_review_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_qualifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "type" "SupplierQualificationType" NOT NULL,
    "quality_system_score" INTEGER NOT NULL,
    "compliance_score" INTEGER NOT NULL,
    "delivery_score" INTEGER NOT NULL,
    "service_score" INTEGER NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "evidence_summary" VARCHAR(5000) NOT NULL,
    "recommendation" "SupplierRecommendation" NOT NULL,
    "conditions" VARCHAR(3000),
    "quality_risk_id" UUID,
    "evaluated_by_user_id" UUID NOT NULL,
    "evaluation_session_id" UUID NOT NULL,
    "meaning" "SupplierSignatureMeaning" NOT NULL DEFAULT 'QUALIFICATION_ASSESSMENT',
    "authentication_method" "SupplierAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "status" "SupplierQualificationStatus" NOT NULL DEFAULT 'PENDING_DECISION',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_qualification_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "qualification_id" UUID NOT NULL,
    "decision" "SupplierQualificationDecisionType" NOT NULL,
    "rationale" VARCHAR(3000) NOT NULL,
    "next_review_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID NOT NULL,
    "decision_session_id" UUID NOT NULL,
    "meaning" "SupplierSignatureMeaning" NOT NULL DEFAULT 'QUALIFICATION_DECISION',
    "authentication_method" "SupplierAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "decided_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_qualification_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_scar_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_scar_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- CreateTable
CREATE TABLE "supplier_scars" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "requirement_reference" VARCHAR(1000) NOT NULL,
    "severity" "SupplierScarSeverity" NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "capa_id" UUID,
    "change_control_id" UUID,
    "audit_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "status" "SupplierScarStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_scars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_scar_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scar_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "response" VARCHAR(5000) NOT NULL,
    "root_cause" VARCHAR(3000) NOT NULL,
    "correction" VARCHAR(3000) NOT NULL,
    "corrective_action" VARCHAR(5000) NOT NULL,
    "evidence_reference" VARCHAR(3000) NOT NULL,
    "responded_by_user_id" UUID NOT NULL,
    "response_session_id" UUID NOT NULL,
    "response_meaning" "SupplierSignatureMeaning" NOT NULL DEFAULT 'SCAR_RESPONSE',
    "authentication_method" "SupplierAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "responded_at" TIMESTAMPTZ(3) NOT NULL,
    "response_record_hash" CHAR(64) NOT NULL,
    "decision" "SupplierScarResponseDecision",
    "review_comment" VARCHAR(3000),
    "reviewed_by_user_id" UUID,
    "review_session_id" UUID,
    "review_meaning" "SupplierSignatureMeaning",
    "reviewed_at" TIMESTAMPTZ(3),
    "review_record_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_scar_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_status_review_idx" ON "suppliers"("tenant_id", "status", "next_review_at");

-- CreateIndex
CREATE INDEX "suppliers_criticality_category_idx" ON "suppliers"("tenant_id", "criticality", "category");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_id_key" ON "suppliers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_registration_key" ON "suppliers"("tenant_id", "registration_number");

-- CreateIndex
CREATE INDEX "supplier_qualifications_status_idx" ON "supplier_qualifications"("tenant_id", "supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_qualifications_tenant_id_id_key" ON "supplier_qualifications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_qualifications_cycle_key" ON "supplier_qualifications"("tenant_id", "supplier_id", "cycle_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_decisions_tenant_id_id_key" ON "supplier_qualification_decisions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_decisions_qualification_key" ON "supplier_qualification_decisions"("tenant_id", "qualification_id");

-- CreateIndex
CREATE INDEX "supplier_scars_supplier_status_due_idx" ON "supplier_scars"("tenant_id", "supplier_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scars_tenant_id_id_key" ON "supplier_scars"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scars_tenant_code_key" ON "supplier_scars"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "supplier_scar_responses_scar_idx" ON "supplier_scar_responses"("tenant_id", "scar_id", "responded_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scar_responses_tenant_id_id_key" ON "supplier_scar_responses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scar_responses_attempt_key" ON "supplier_scar_responses"("tenant_id", "scar_id", "attempt_number");

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_audit_fkey" TO "quality_risk_assessments_tenant_id_audit_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_canceller_fkey" TO "quality_risk_assessments_tenant_id_cancelled_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_capa_fkey" TO "quality_risk_assessments_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_change_fkey" TO "quality_risk_assessments_tenant_id_change_control_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_creator_fkey" TO "quality_risk_assessments_tenant_id_created_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_deviation_fkey" TO "quality_risk_assessments_tenant_id_deviation_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_owner_fkey" TO "quality_risk_assessments_tenant_id_owner_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_reviewer_fkey" TO "quality_risk_assessments_tenant_id_reviewer_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_assessments" RENAME CONSTRAINT "quality_risks_tenant_fkey" TO "quality_risk_assessments_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_items" RENAME CONSTRAINT "quality_risk_items_assignee_fkey" TO "quality_risk_items_tenant_id_assigned_to_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_items" RENAME CONSTRAINT "quality_risk_items_completer_fkey" TO "quality_risk_items_tenant_id_completed_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_items" RENAME CONSTRAINT "quality_risk_items_risk_fkey" TO "quality_risk_items_tenant_id_risk_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_items" RENAME CONSTRAINT "quality_risk_items_session_fkey" TO "quality_risk_items_tenant_id_completed_by_user_id_completi_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_items" RENAME CONSTRAINT "quality_risk_items_tenant_fkey" TO "quality_risk_items_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_reviews" RENAME CONSTRAINT "quality_risk_reviews_reviewer_fkey" TO "quality_risk_reviews_tenant_id_reviewed_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_reviews" RENAME CONSTRAINT "quality_risk_reviews_risk_fkey" TO "quality_risk_reviews_tenant_id_risk_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_reviews" RENAME CONSTRAINT "quality_risk_reviews_session_fkey" TO "quality_risk_reviews_tenant_id_reviewed_by_user_id_review__fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_reviews" RENAME CONSTRAINT "quality_risk_reviews_tenant_fkey" TO "quality_risk_reviews_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "quality_risk_sequences" RENAME CONSTRAINT "quality_risk_sequences_tenant_fkey" TO "quality_risk_sequences_tenant_id_fkey";

-- AddForeignKey
ALTER TABLE "supplier_sequences" ADD CONSTRAINT "supplier_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_quality_owner_user_id_fkey" FOREIGN KEY ("tenant_id", "quality_owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_approver_user_id_fkey" FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_tenant_id_quality_risk_id_fkey" FOREIGN KEY ("tenant_id", "quality_risk_id") REFERENCES "quality_risk_assessments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_evaluator_fkey" FOREIGN KEY ("tenant_id", "evaluated_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_session_fkey" FOREIGN KEY ("tenant_id", "evaluated_by_user_id", "evaluation_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualification_decisions" ADD CONSTRAINT "supplier_qualification_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualification_decisions" ADD CONSTRAINT "supplier_qualification_decisions_tenant_id_qualification_i_fkey" FOREIGN KEY ("tenant_id", "qualification_id") REFERENCES "supplier_qualifications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualification_decisions" ADD CONSTRAINT "supplier_decisions_signer_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_qualification_decisions" ADD CONSTRAINT "supplier_decisions_session_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id", "decision_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_sequences" ADD CONSTRAINT "supplier_scar_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "suppliers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_capa_id_fkey" FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_audit_id_fkey" FOREIGN KEY ("tenant_id", "audit_id") REFERENCES "audits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scars" ADD CONSTRAINT "supplier_scars_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_tenant_id_scar_id_fkey" FOREIGN KEY ("tenant_id", "scar_id") REFERENCES "supplier_scars"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_submitter_fkey" FOREIGN KEY ("tenant_id", "responded_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_reviewer_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_session_fkey" FOREIGN KEY ("tenant_id", "responded_by_user_id", "response_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_reviews_session_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id", "review_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GMP supplier-quality invariants
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_independent_approver_check"
  CHECK ("quality_owner_user_id" <> "approver_user_id" AND "created_by_user_id" <> "approver_user_id");
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_cycle_check" CHECK ("cycle_number" > 0);
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_scores_check" CHECK (
  "quality_system_score" BETWEEN 1 AND 5 AND "compliance_score" BETWEEN 1 AND 5
  AND "delivery_score" BETWEEN 1 AND 5 AND "service_score" BETWEEN 1 AND 5
  AND "overall_score" = ("quality_system_score" + "compliance_score" + "delivery_score" + "service_score") * 5
);
ALTER TABLE "supplier_qualifications" ADD CONSTRAINT "supplier_qualifications_conditions_check" CHECK (
  "recommendation" <> 'CONDITIONALLY_APPROVE' OR "conditions" IS NOT NULL
);
ALTER TABLE "supplier_qualification_decisions" ADD CONSTRAINT "supplier_decisions_review_date_check" CHECK (
  ("decision" = 'DISQUALIFY' AND "next_review_at" IS NULL)
  OR ("decision" IN ('APPROVE', 'CONDITIONALLY_APPROVE') AND "next_review_at" IS NOT NULL)
);
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_attempt_check" CHECK ("attempt_number" > 0);
ALTER TABLE "supplier_scar_responses" ADD CONSTRAINT "supplier_scar_responses_review_check" CHECK (
  ("decision" IS NULL AND "review_comment" IS NULL AND "reviewed_by_user_id" IS NULL
    AND "review_session_id" IS NULL AND "review_meaning" IS NULL AND "reviewed_at" IS NULL AND "review_record_hash" IS NULL)
  OR
  ("decision" IS NOT NULL AND "review_comment" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL
    AND "review_session_id" IS NOT NULL AND "review_meaning" = 'SCAR_RESPONSE_REVIEW'
    AND "reviewed_at" IS NOT NULL AND "review_record_hash" IS NOT NULL)
);

CREATE UNIQUE INDEX "supplier_qualifications_one_pending_idx"
  ON "supplier_qualifications" ("tenant_id", "supplier_id") WHERE "status" = 'PENDING_DECISION';
CREATE UNIQUE INDEX "supplier_scar_responses_one_pending_idx"
  ON "supplier_scar_responses" ("tenant_id", "scar_id") WHERE "decision" IS NULL;

CREATE FUNCTION public.guard_supplier_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.legal_name, NEW.trade_name, NEW.registration_number,
         NEW.category, NEW.criticality, NEW.scope_of_supply, NEW.manufacturing_site,
         NEW.country_code, NEW.contact_name, NEW.contact_email, NEW.quality_owner_user_id,
         NEW.approver_user_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.legal_name, OLD.trade_name, OLD.registration_number,
         OLD.category, OLD.criticality, OLD.scope_of_supply, OLD.manufacturing_site,
         OLD.country_code, OLD.contact_name, OLD.contact_email, OLD.quality_owner_user_id,
         OLD.approver_user_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The controlled supplier master record is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'DISQUALIFIED' OR NEW.status = 'PENDING_QUALIFICATION' OR NOT EXISTS (
    SELECT 1
    FROM public.supplier_qualifications q
    JOIN public.supplier_qualification_decisions d
      ON d.tenant_id = q.tenant_id AND d.qualification_id = q.id
    WHERE q.tenant_id = NEW.tenant_id AND q.supplier_id = NEW.id AND q.status = 'COMPLETED'
      AND ((NEW.status = 'APPROVED' AND d.decision = 'APPROVE')
        OR (NEW.status = 'CONDITIONALLY_APPROVED' AND d.decision = 'CONDITIONALLY_APPROVE')
        OR (NEW.status = 'DISQUALIFIED' AND d.decision = 'DISQUALIFY'))
      AND d.next_review_at IS NOT DISTINCT FROM NEW.next_review_at
    ORDER BY q.cycle_number DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'A matching completed qualification decision is required.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_supplier_qualification_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_cycle INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(q.cycle_number), 0) + 1 INTO expected_cycle
    FROM public.supplier_qualifications q
    WHERE q.tenant_id = NEW.tenant_id AND q.supplier_id = NEW.supplier_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.supplier_id
        AND s.status <> 'DISQUALIFIED' AND s.quality_owner_user_id = NEW.evaluated_by_user_id
        AND s.approver_user_id <> NEW.evaluated_by_user_id
    ) OR NEW.cycle_number <> expected_cycle
      OR (expected_cycle = 1 AND NEW.type <> 'INITIAL')
      OR (expected_cycle > 1 AND NEW.type = 'INITIAL') THEN
      RAISE EXCEPTION 'Invalid supplier qualification assessment.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.supplier_id, NEW.cycle_number, NEW.type, NEW.quality_system_score,
         NEW.compliance_score, NEW.delivery_score, NEW.service_score, NEW.overall_score,
         NEW.evidence_summary, NEW.recommendation, NEW.conditions, NEW.quality_risk_id,
         NEW.evaluated_by_user_id, NEW.evaluation_session_id, NEW.meaning,
         NEW.authentication_method, NEW.evaluated_at, NEW.record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.supplier_id, OLD.cycle_number, OLD.type, OLD.quality_system_score,
         OLD.compliance_score, OLD.delivery_score, OLD.service_score, OLD.overall_score,
         OLD.evidence_summary, OLD.recommendation, OLD.conditions, OLD.quality_risk_id,
         OLD.evaluated_by_user_id, OLD.evaluation_session_id, OLD.meaning,
         OLD.authentication_method, OLD.evaluated_at, OLD.record_hash, OLD.created_at)
    OR OLD.status <> 'PENDING_DECISION' OR NEW.status <> 'COMPLETED'
    OR NOT EXISTS (
      SELECT 1 FROM public.supplier_qualification_decisions d
      WHERE d.tenant_id = NEW.tenant_id AND d.qualification_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'Signed supplier qualifications are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_supplier_decision_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_qualifications q
    JOIN public.suppliers s ON s.tenant_id = q.tenant_id AND s.id = q.supplier_id
    WHERE q.tenant_id = NEW.tenant_id AND q.id = NEW.qualification_id
      AND q.status = 'PENDING_DECISION' AND s.approver_user_id = NEW.decided_by_user_id
      AND q.evaluated_by_user_id <> NEW.decided_by_user_id
  ) OR (NEW.decision <> 'DISQUALIFY' AND NEW.next_review_at <= NEW.decided_at) THEN
    RAISE EXCEPTION 'Only the independent approver may sign a valid qualification decision.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_supplier_scar_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.supplier_id
        AND s.status IN ('APPROVED', 'CONDITIONALLY_APPROVED')
        AND s.quality_owner_user_id = NEW.created_by_user_id
    ) THEN
      RAISE EXCEPTION 'Only the quality owner may issue a SCAR for an approved supplier.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.supplier_id, NEW.code, NEW.title, NEW.description,
         NEW.requirement_reference, NEW.severity, NEW.due_at, NEW.capa_id,
         NEW.change_control_id, NEW.audit_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.supplier_id, OLD.code, OLD.title, OLD.description,
         OLD.requirement_reference, OLD.severity, OLD.due_at, OLD.capa_id,
         OLD.change_control_id, OLD.audit_id, OLD.created_by_user_id, OLD.created_at)
     OR NOT ((OLD.status = 'OPEN' AND NEW.status = 'RESPONSE_SUBMITTED')
       OR (OLD.status = 'RESPONSE_SUBMITTED' AND NEW.status IN ('OPEN', 'CLOSED')))
     OR NOT EXISTS (
       SELECT 1 FROM public.supplier_scar_responses r
       WHERE r.tenant_id = NEW.tenant_id AND r.scar_id = NEW.id
         AND ((NEW.status = 'RESPONSE_SUBMITTED' AND r.decision IS NULL)
           OR (NEW.status = 'OPEN' AND r.decision = 'REQUEST_REVISION')
           OR (NEW.status = 'CLOSED' AND r.decision = 'ACCEPT'))
       ORDER BY r.attempt_number DESC LIMIT 1
     ) THEN
    RAISE EXCEPTION 'Invalid supplier SCAR lifecycle transition.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_supplier_scar_response_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_attempt INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(r.attempt_number), 0) + 1 INTO expected_attempt
    FROM public.supplier_scar_responses r
    WHERE r.tenant_id = NEW.tenant_id AND r.scar_id = NEW.scar_id;
    IF NEW.attempt_number <> expected_attempt OR NOT EXISTS (
      SELECT 1 FROM public.supplier_scars scar
      JOIN public.suppliers s ON s.tenant_id = scar.tenant_id AND s.id = scar.supplier_id
      WHERE scar.tenant_id = NEW.tenant_id AND scar.id = NEW.scar_id AND scar.status = 'OPEN'
        AND s.quality_owner_user_id = NEW.responded_by_user_id
    ) THEN
      RAISE EXCEPTION 'Invalid supplier SCAR response.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.scar_id, NEW.attempt_number, NEW.response, NEW.root_cause,
         NEW.correction, NEW.corrective_action, NEW.evidence_reference,
         NEW.responded_by_user_id, NEW.response_session_id, NEW.response_meaning,
         NEW.authentication_method, NEW.responded_at, NEW.response_record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.scar_id, OLD.attempt_number, OLD.response, OLD.root_cause,
         OLD.correction, OLD.corrective_action, OLD.evidence_reference,
         OLD.responded_by_user_id, OLD.response_session_id, OLD.response_meaning,
         OLD.authentication_method, OLD.responded_at, OLD.response_record_hash, OLD.created_at)
    OR OLD.decision IS NOT NULL OR NEW.decision IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.supplier_scars scar
      JOIN public.suppliers s ON s.tenant_id = scar.tenant_id AND s.id = scar.supplier_id
      WHERE scar.tenant_id = NEW.tenant_id AND scar.id = NEW.scar_id
        AND scar.status = 'RESPONSE_SUBMITTED' AND s.approver_user_id = NEW.reviewed_by_user_id
        AND NEW.reviewed_by_user_id <> NEW.responded_by_user_id
    ) THEN
    RAISE EXCEPTION 'Only the independent approver may review an immutable SCAR response.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_supplier_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Controlled supplier quality records cannot be changed or deleted.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER suppliers_update_guard BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_update();
CREATE TRIGGER suppliers_delete_guard BEFORE DELETE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_record_mutation();
CREATE TRIGGER supplier_qualifications_mutation_guard BEFORE INSERT OR UPDATE ON "supplier_qualifications" FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_qualification_mutation();
CREATE TRIGGER supplier_qualifications_delete_guard BEFORE DELETE ON "supplier_qualifications" FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_record_mutation();
CREATE TRIGGER supplier_decisions_insert_guard BEFORE INSERT ON "supplier_qualification_decisions" FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_decision_insert();
CREATE TRIGGER supplier_decisions_immutable BEFORE UPDATE OR DELETE ON "supplier_qualification_decisions" FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_record_mutation();
CREATE TRIGGER supplier_scars_mutation_guard BEFORE INSERT OR UPDATE ON "supplier_scars" FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_scar_mutation();
CREATE TRIGGER supplier_scars_delete_guard BEFORE DELETE ON "supplier_scars" FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_record_mutation();
CREATE TRIGGER supplier_scar_responses_mutation_guard BEFORE INSERT OR UPDATE ON "supplier_scar_responses" FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_scar_response_mutation();
CREATE TRIGGER supplier_scar_responses_delete_guard BEFORE DELETE ON "supplier_scar_responses" FOR EACH ROW EXECUTE FUNCTION public.prevent_supplier_record_mutation();

REVOKE ALL ON FUNCTION public.guard_supplier_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_supplier_qualification_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_supplier_decision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_supplier_scar_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_supplier_scar_response_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_supplier_record_mutation() FROM PUBLIC;

ALTER TABLE "supplier_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_qualifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_qualifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_qualification_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_qualification_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scar_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scar_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scars" FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scar_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scar_responses" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "supplier_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "suppliers" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "supplier_qualifications" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "supplier_qualification_decisions" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "supplier_scar_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "supplier_scars" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "supplier_scar_responses" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "supplier_sequences", "suppliers", "supplier_qualifications", "supplier_scar_sequences", "supplier_scars", "supplier_scar_responses" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "supplier_qualification_decisions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "supplier_sequences", "suppliers", "supplier_qualifications", "supplier_qualification_decisions", "supplier_scar_sequences", "supplier_scars", "supplier_scar_responses" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "supplier_qualification_decisions" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'suppliers.read', 'View suppliers, qualifications, decisions, and SCAR evidence.'),
  (gen_random_uuid(), 'suppliers.create', 'Create controlled supplier master records.'),
  (gen_random_uuid(), 'suppliers.assess', 'Complete and sign supplier qualification assessments.'),
  (gen_random_uuid(), 'suppliers.approve', 'Independently approve or disqualify suppliers.'),
  (gen_random_uuid(), 'suppliers.scar', 'Issue SCARs and sign supplier responses.'),
  (gen_random_uuid(), 'suppliers.review_scar', 'Independently review and sign SCAR response decisions.')
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
      ('Administrator', 'suppliers.read'), ('Administrator', 'suppliers.create'), ('Administrator', 'suppliers.assess'), ('Administrator', 'suppliers.approve'), ('Administrator', 'suppliers.scar'), ('Administrator', 'suppliers.review_scar'),
      ('QA Manager', 'suppliers.read'), ('QA Manager', 'suppliers.create'), ('QA Manager', 'suppliers.assess'), ('QA Manager', 'suppliers.approve'), ('QA Manager', 'suppliers.scar'), ('QA Manager', 'suppliers.review_scar'),
      ('Document Controller', 'suppliers.read'), ('Document Controller', 'suppliers.create'), ('Document Controller', 'suppliers.assess'), ('Document Controller', 'suppliers.scar'),
      ('Operator', 'suppliers.read'), ('Operator', 'suppliers.assess'), ('Operator', 'suppliers.scar'),
      ('Auditor', 'suppliers.read'), ('Auditor', 'suppliers.approve'), ('Auditor', 'suppliers.review_scar')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
