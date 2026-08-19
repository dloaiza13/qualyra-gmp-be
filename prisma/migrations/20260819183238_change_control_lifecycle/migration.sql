-- CreateEnum
CREATE TYPE "ChangeControlCategory" AS ENUM ('DOCUMENT', 'PROCESS', 'EQUIPMENT', 'SOFTWARE', 'FACILITY', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeControlStatus" AS ENUM ('PROPOSED', 'ASSESSED', 'APPROVED', 'IMPLEMENTING', 'PENDING_VERIFICATION', 'CLOSED', 'REJECTED', 'VERIFICATION_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ChangeDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "ChangeTaskStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ChangeVerificationDecision" AS ENUM ('EFFECTIVE', 'INEFFECTIVE');

-- CreateEnum
CREATE TYPE "ChangeSignatureMeaning" AS ENUM ('CHANGE_APPROVAL', 'CHANGE_TASK_COMPLETION', 'CHANGE_VERIFICATION');

-- CreateEnum
CREATE TYPE "ChangeAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

-- CreateTable
CREATE TABLE "change_control_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "change_control_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- CreateTable
CREATE TABLE "change_controls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "justification" VARCHAR(3000) NOT NULL,
    "category" "ChangeControlCategory" NOT NULL,
    "status" "ChangeControlStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposed_by_user_id" UUID NOT NULL,
    "target_completion_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "change_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "impact_summary" VARCHAR(5000) NOT NULL,
    "quality_impact" VARCHAR(3000) NOT NULL,
    "regulatory_impact" VARCHAR(3000) NOT NULL,
    "validation_impact" VARCHAR(3000) NOT NULL,
    "training_impact" VARCHAR(3000) NOT NULL,
    "document_impact" VARCHAR(3000) NOT NULL,
    "risk_level" "ChangeRiskLevel" NOT NULL,
    "risk_rationale" VARCHAR(3000) NOT NULL,
    "implementation_plan" VARCHAR(5000) NOT NULL,
    "rollback_plan" VARCHAR(3000) NOT NULL,
    "assessed_by_user_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "approver_user_id" UUID NOT NULL,
    "verifier_user_id" UUID NOT NULL,
    "verification_criterion" VARCHAR(3000) NOT NULL,
    "assessed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_control_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "decision" "ChangeDecision" NOT NULL,
    "comment" VARCHAR(2000) NOT NULL,
    "decided_by_user_id" UUID NOT NULL,
    "decision_session_id" UUID NOT NULL,
    "meaning" "ChangeSignatureMeaning" NOT NULL DEFAULT 'CHANGE_APPROVAL',
    "authentication_method" "ChangeAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "decided_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_control_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(3000) NOT NULL,
    "assigned_to_user_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ChangeTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completion_comment" VARCHAR(2000),
    "completion_session_id" UUID,
    "meaning" "ChangeSignatureMeaning",
    "authentication_method" "ChangeAuthenticationMethod",
    "completed_at" TIMESTAMPTZ(3),
    "record_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_control_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_verifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "decision" "ChangeVerificationDecision" NOT NULL,
    "evidence" VARCHAR(5000) NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "verification_session_id" UUID NOT NULL,
    "meaning" "ChangeSignatureMeaning" NOT NULL DEFAULT 'CHANGE_VERIFICATION',
    "authentication_method" "ChangeAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_control_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_controls_status_target_idx" ON "change_controls"("tenant_id", "status", "target_completion_at");

-- CreateIndex
CREATE INDEX "change_controls_created_idx" ON "change_controls"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "change_controls_tenant_id_id_key" ON "change_controls"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_controls_tenant_id_code_key" ON "change_controls"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "change_assessments_tenant_id_id_key" ON "change_control_assessments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_assessments_change_control_key" ON "change_control_assessments"("tenant_id", "change_control_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_decisions_tenant_id_id_key" ON "change_control_decisions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_decisions_change_control_key" ON "change_control_decisions"("tenant_id", "change_control_id");

-- CreateIndex
CREATE INDEX "change_tasks_change_status_due_idx" ON "change_control_tasks"("tenant_id", "change_control_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "change_tasks_assignee_status_due_idx" ON "change_control_tasks"("tenant_id", "assigned_to_user_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "change_tasks_tenant_id_id_key" ON "change_control_tasks"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_verifications_tenant_id_id_key" ON "change_control_verifications"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_verifications_change_control_key" ON "change_control_verifications"("tenant_id", "change_control_id");

-- RenameForeignKey
ALTER TABLE "capa_action_evidence_references" RENAME CONSTRAINT "capa_action_evidence_action_fkey" TO "capa_action_evidence_references_tenant_id_action_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_evidence_references" RENAME CONSTRAINT "capa_action_evidence_capa_fkey" TO "capa_action_evidence_references_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_evidence_references" RENAME CONSTRAINT "capa_action_evidence_tenant_id_fkey" TO "capa_action_evidence_references_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_evidence_references" RENAME CONSTRAINT "capa_action_evidence_upload_fkey" TO "capa_action_evidence_references_tenant_id_evidence_upload__fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_extensions" RENAME CONSTRAINT "capa_action_extensions_action_fkey" TO "capa_action_extensions_tenant_id_action_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_extensions" RENAME CONSTRAINT "capa_action_extensions_approver_fkey" TO "capa_action_extensions_tenant_id_approved_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_extensions" RENAME CONSTRAINT "capa_action_extensions_capa_fkey" TO "capa_action_extensions_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_action_extensions" RENAME CONSTRAINT "capa_action_extensions_session_fkey" TO "capa_action_extensions_tenant_id_approved_by_user_id_appro_fkey";

-- RenameForeignKey
ALTER TABLE "capa_actions" RENAME CONSTRAINT "capa_actions_completion_session_fkey" TO "capa_actions_tenant_id_assigned_to_user_id_completion_sess_fkey";

-- RenameForeignKey
ALTER TABLE "capa_actions" RENAME CONSTRAINT "capa_actions_follow_up_cycle_fkey" TO "capa_actions_tenant_id_follow_up_cycle_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_actions" RENAME CONSTRAINT "capa_actions_tenant_assignee_fkey" TO "capa_actions_tenant_id_assigned_to_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_actions" RENAME CONSTRAINT "capa_actions_tenant_capa_fkey" TO "capa_actions_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_audit_exports" RENAME CONSTRAINT "capa_audit_exports_capa_fkey" TO "capa_audit_exports_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_audit_exports" RENAME CONSTRAINT "capa_audit_exports_exporter_fkey" TO "capa_audit_exports_tenant_id_exported_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_audit_exports" RENAME CONSTRAINT "capa_audit_exports_tenant_fkey" TO "capa_audit_exports_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_effectiveness_reviews" RENAME CONSTRAINT "capa_effectiveness_reviews_completion_session_fkey" TO "capa_effectiveness_reviews_tenant_id_assigned_to_user_id_c_fkey";

-- RenameForeignKey
ALTER TABLE "capa_effectiveness_reviews" RENAME CONSTRAINT "capa_effectiveness_reviews_tenant_assignee_fkey" TO "capa_effectiveness_reviews_tenant_id_assigned_to_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_effectiveness_reviews" RENAME CONSTRAINT "capa_effectiveness_reviews_tenant_capa_fkey" TO "capa_effectiveness_reviews_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_effectiveness_reviews" RENAME CONSTRAINT "capa_effectiveness_reviews_tenant_scheduler_fkey" TO "capa_effectiveness_reviews_tenant_id_scheduled_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_evidence_uploads" RENAME CONSTRAINT "capa_evidence_uploads_action_fkey" TO "capa_evidence_uploads_tenant_id_action_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_evidence_uploads" RENAME CONSTRAINT "capa_evidence_uploads_capa_fkey" TO "capa_evidence_uploads_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_evidence_uploads" RENAME CONSTRAINT "capa_evidence_uploads_tenant_fkey" TO "capa_evidence_uploads_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_evidence_uploads" RENAME CONSTRAINT "capa_evidence_uploads_uploader_fkey" TO "capa_evidence_uploads_tenant_id_uploaded_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_follow_up_cycles" RENAME CONSTRAINT "capa_follow_up_cycles_creator_fkey" TO "capa_follow_up_cycles_tenant_id_created_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_follow_up_cycles" RENAME CONSTRAINT "capa_follow_up_cycles_source_review_fkey" TO "capa_follow_up_cycles_tenant_id_source_effectiveness_revie_fkey";

-- RenameForeignKey
ALTER TABLE "capa_follow_up_cycles" RENAME CONSTRAINT "capa_follow_up_cycles_tenant_capa_fkey" TO "capa_follow_up_cycles_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_notifications" RENAME CONSTRAINT "capa_notifications_action_fkey" TO "capa_notifications_tenant_id_action_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_notifications" RENAME CONSTRAINT "capa_notifications_capa_fkey" TO "capa_notifications_tenant_id_capa_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_notifications" RENAME CONSTRAINT "capa_notifications_recipient_fkey" TO "capa_notifications_tenant_id_recipient_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_notifications" RENAME CONSTRAINT "capa_notifications_review_fkey" TO "capa_notifications_tenant_id_effectiveness_review_id_fkey";

-- RenameForeignKey
ALTER TABLE "capa_notifications" RENAME CONSTRAINT "capa_notifications_tenant_fkey" TO "capa_notifications_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "capas" RENAME CONSTRAINT "capas_tenant_creator_fkey" TO "capas_tenant_id_created_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "capas" RENAME CONSTRAINT "capas_tenant_deviation_fkey" TO "capas_tenant_id_deviation_id_fkey";

-- RenameForeignKey
ALTER TABLE "capas" RENAME CONSTRAINT "capas_tenant_investigation_fkey" TO "capas_tenant_id_investigation_id_fkey";

-- RenameForeignKey
ALTER TABLE "deviation_investigations" RENAME CONSTRAINT "deviation_investigations_completion_session_fkey" TO "deviation_investigations_tenant_id_completed_by_user_id_co_fkey";

-- RenameForeignKey
ALTER TABLE "document_obsolescences" RENAME CONSTRAINT "document_obsolescences_tenant_id_document_id_document_version_i" TO "document_obsolescences_tenant_id_document_id_document_vers_fkey";

-- RenameForeignKey
ALTER TABLE "document_obsolescences" RENAME CONSTRAINT "document_obsolescences_tenant_id_obsoleted_by_user_id_session_i" TO "document_obsolescences_tenant_id_obsoleted_by_user_id_sess_fkey";

-- RenameForeignKey
ALTER TABLE "document_periodic_reviews" RENAME CONSTRAINT "document_periodic_reviews_tenant_id_document_id_document_versio" TO "document_periodic_reviews_tenant_id_document_id_document_v_fkey";

-- RenameForeignKey
ALTER TABLE "document_releases" RENAME CONSTRAINT "document_releases_tenant_id_document_id_document_version_id_fke" TO "document_releases_tenant_id_document_id_document_version_i_fkey";

-- RenameForeignKey
ALTER TABLE "document_workflows" RENAME CONSTRAINT "document_workflows_tenant_id_document_id_document_version_id_fk" TO "document_workflows_tenant_id_document_id_document_version__fkey";

-- RenameForeignKey
ALTER TABLE "training_assignments" RENAME CONSTRAINT "training_assignments_tenant_id_assigned_to_user_id_completion_s" TO "training_assignments_tenant_id_assigned_to_user_id_complet_fkey";

-- RenameForeignKey
ALTER TABLE "training_assignments" RENAME CONSTRAINT "training_assignments_tenant_id_document_id_document_version_id_" TO "training_assignments_tenant_id_document_id_document_versio_fkey";

-- AddForeignKey
ALTER TABLE "change_control_sequences" ADD CONSTRAINT "change_control_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_tenant_id_proposed_by_user_id_fkey" FOREIGN KEY ("tenant_id", "proposed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_tenant_id_cancelled_by_user_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_assessed_by_user_id_fkey" FOREIGN KEY ("tenant_id", "assessed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_owner_user_id_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_approver_user_id_fkey" FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_control_assessments_tenant_id_verifier_user_id_fkey" FOREIGN KEY ("tenant_id", "verifier_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_decisions" ADD CONSTRAINT "change_control_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_decisions" ADD CONSTRAINT "change_control_decisions_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_decisions" ADD CONSTRAINT "change_control_decisions_tenant_id_decided_by_user_id_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_decisions" ADD CONSTRAINT "change_control_decisions_tenant_id_decided_by_user_id_deci_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id", "decision_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_tasks" ADD CONSTRAINT "change_control_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_tasks" ADD CONSTRAINT "change_control_tasks_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_tasks" ADD CONSTRAINT "change_control_tasks_tenant_id_assigned_to_user_id_fkey" FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_tasks" ADD CONSTRAINT "change_control_tasks_tenant_id_assigned_to_user_id_complet_fkey" FOREIGN KEY ("tenant_id", "assigned_to_user_id", "completion_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_verifications" ADD CONSTRAINT "change_control_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_verifications" ADD CONSTRAINT "change_control_verifications_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_verifications" ADD CONSTRAINT "change_verifications_verifier_fkey" FOREIGN KEY ("tenant_id", "verified_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_verifications" ADD CONSTRAINT "change_verifications_session_fkey" FOREIGN KEY ("tenant_id", "verified_by_user_id", "verification_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants: immutable proposal content, controlled state transitions,
-- independent approval/verification and append-only signed evidence.
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_content_check" CHECK (
  char_length(btrim("code")) BETWEEN 10 AND 25
  AND char_length(btrim("title")) BETWEEN 5 AND 200
  AND char_length(btrim("description")) BETWEEN 10 AND 5000
  AND char_length(btrim("justification")) BETWEEN 10 AND 3000
  AND "target_completion_at" > "created_at"
  AND (("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancelled_at" IS NOT NULL AND char_length(btrim("cancellation_reason")) BETWEEN 3 AND 500)
    OR ("status" <> 'CANCELLED' AND "cancelled_by_user_id" IS NULL AND "cancelled_at" IS NULL AND "cancellation_reason" IS NULL))
);
ALTER TABLE "change_control_assessments" ADD CONSTRAINT "change_assessment_independence_check" CHECK (
  "assessed_by_user_id" <> "approver_user_id"
  AND "assessed_by_user_id" <> "verifier_user_id"
  AND "approver_user_id" <> "verifier_user_id"
  AND "owner_user_id" <> "verifier_user_id"
);
ALTER TABLE "change_control_decisions" ADD CONSTRAINT "change_decisions_signature_check" CHECK (
  "meaning" = 'CHANGE_APPROVAL' AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
  AND "record_hash" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "change_control_tasks" ADD CONSTRAINT "change_tasks_completion_check" CHECK (
  ("status" = 'OPEN' AND "completion_comment" IS NULL AND "completion_session_id" IS NULL AND "meaning" IS NULL AND "authentication_method" IS NULL AND "completed_at" IS NULL AND "record_hash" IS NULL)
  OR
  ("status" = 'COMPLETED' AND char_length(btrim("completion_comment")) BETWEEN 3 AND 2000 AND "completion_session_id" IS NOT NULL AND "meaning" = 'CHANGE_TASK_COMPLETION' AND "authentication_method" = 'PASSWORD_REAUTHENTICATION' AND "completed_at" IS NOT NULL AND "record_hash" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "change_control_verifications" ADD CONSTRAINT "change_verifications_signature_check" CHECK (
  "meaning" = 'CHANGE_VERIFICATION' AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
  AND "record_hash" ~ '^[0-9a-f]{64}$'
);

CREATE FUNCTION public.guard_change_control_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.code IS DISTINCT FROM NEW.code
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.justification IS DISTINCT FROM NEW.justification
    OR OLD.category IS DISTINCT FROM NEW.category
    OR OLD.proposed_by_user_id IS DISTINCT FROM NEW.proposed_by_user_id
    OR OLD.target_completion_at IS DISTINCT FROM NEW.target_completion_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Change proposal evidence is immutable.' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'PROPOSED' AND NEW.status IN ('ASSESSED', 'CANCELLED'))
    OR (OLD.status = 'ASSESSED' AND NEW.status IN ('APPROVED', 'REJECTED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('IMPLEMENTING', 'PENDING_VERIFICATION'))
    OR (OLD.status = 'IMPLEMENTING' AND NEW.status = 'PENDING_VERIFICATION')
    OR (OLD.status = 'PENDING_VERIFICATION' AND NEW.status IN ('CLOSED', 'VERIFICATION_FAILED'))
  ) THEN
    RAISE EXCEPTION 'Invalid change control lifecycle transition.' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'ASSESSED' AND NOT EXISTS (
    SELECT 1 FROM public.change_control_assessments assessment
    WHERE assessment.tenant_id = NEW.tenant_id AND assessment.change_control_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Assessed changes require an immutable assessment.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('APPROVED', 'REJECTED') AND NOT EXISTS (
    SELECT 1 FROM public.change_control_decisions decision
    WHERE decision.tenant_id = NEW.tenant_id AND decision.change_control_id = NEW.id
      AND ((NEW.status = 'APPROVED' AND decision.decision = 'APPROVE') OR (NEW.status = 'REJECTED' AND decision.decision = 'REJECT'))
  ) THEN
    RAISE EXCEPTION 'Approval transitions require a matching signed decision.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'PENDING_VERIFICATION' AND EXISTS (
    SELECT 1 FROM public.change_control_tasks task
    WHERE task.tenant_id = NEW.tenant_id AND task.change_control_id = NEW.id AND task.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Verification requires all implementation tasks completed.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('CLOSED', 'VERIFICATION_FAILED') AND NOT EXISTS (
    SELECT 1 FROM public.change_control_verifications verification
    WHERE verification.tenant_id = NEW.tenant_id AND verification.change_control_id = NEW.id
      AND ((NEW.status = 'CLOSED' AND verification.decision = 'EFFECTIVE') OR (NEW.status = 'VERIFICATION_FAILED' AND verification.decision = 'INEFFECTIVE'))
  ) THEN
    RAISE EXCEPTION 'Closure transitions require matching signed verification.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_change_control_transition() FROM PUBLIC;

CREATE FUNCTION public.guard_change_assessment_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE proposer UUID;
BEGIN
  SELECT change.proposed_by_user_id INTO proposer
  FROM public.change_controls change
  WHERE change.tenant_id = NEW.tenant_id AND change.id = NEW.change_control_id AND change.status = 'PROPOSED';
  IF proposer IS NULL OR proposer IN (NEW.assessed_by_user_id, NEW.approver_user_id, NEW.verifier_user_id) THEN
    RAISE EXCEPTION 'Assessment, approval and verification must be independent from the proposer.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_change_assessment_insert() FROM PUBLIC;

CREATE FUNCTION public.guard_change_task_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public.change_control_assessments assessment
      WHERE assessment.tenant_id = NEW.tenant_id AND assessment.change_control_id = NEW.change_control_id
        AND assessment.verifier_user_id = NEW.assigned_to_user_id
    ) THEN
      RAISE EXCEPTION 'The verifier cannot execute implementation tasks.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'OPEN' OR NEW.status <> 'COMPLETED'
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.change_control_id IS DISTINCT FROM NEW.change_control_id
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'A change task may only transition once from open to completed.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.change_controls change
    WHERE change.tenant_id = NEW.tenant_id AND change.id = NEW.change_control_id AND change.status IN ('APPROVED', 'IMPLEMENTING')
  ) THEN
    RAISE EXCEPTION 'Only approved changes may be implemented.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_change_task_mutation() FROM PUBLIC;

CREATE FUNCTION public.guard_change_decision_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.change_controls change
    JOIN public.change_control_assessments assessment ON assessment.tenant_id = change.tenant_id AND assessment.change_control_id = change.id
    WHERE change.tenant_id = NEW.tenant_id AND change.id = NEW.change_control_id AND change.status = 'ASSESSED'
      AND assessment.approver_user_id = NEW.decided_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the independent assigned approver may decide an assessed change.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_change_decision_insert() FROM PUBLIC;

CREATE FUNCTION public.guard_change_verification_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.change_controls change
    JOIN public.change_control_assessments assessment ON assessment.tenant_id = change.tenant_id AND assessment.change_control_id = change.id
    WHERE change.tenant_id = NEW.tenant_id AND change.id = NEW.change_control_id AND change.status = 'PENDING_VERIFICATION'
      AND assessment.verifier_user_id = NEW.verified_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the independent assigned verifier may verify a completed change.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_change_verification_insert() FROM PUBLIC;

CREATE FUNCTION public.prevent_change_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Signed change control evidence is immutable.' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_change_evidence_mutation() FROM PUBLIC;

CREATE TRIGGER change_controls_transition_guard BEFORE UPDATE ON "change_controls" FOR EACH ROW EXECUTE FUNCTION public.guard_change_control_transition();
CREATE TRIGGER change_assessments_insert_guard BEFORE INSERT ON "change_control_assessments" FOR EACH ROW EXECUTE FUNCTION public.guard_change_assessment_insert();
CREATE TRIGGER change_tasks_mutation_guard BEFORE INSERT OR UPDATE ON "change_control_tasks" FOR EACH ROW EXECUTE FUNCTION public.guard_change_task_mutation();
CREATE TRIGGER change_decisions_insert_guard BEFORE INSERT ON "change_control_decisions" FOR EACH ROW EXECUTE FUNCTION public.guard_change_decision_insert();
CREATE TRIGGER change_verifications_insert_guard BEFORE INSERT ON "change_control_verifications" FOR EACH ROW EXECUTE FUNCTION public.guard_change_verification_insert();
CREATE TRIGGER change_assessments_immutable BEFORE UPDATE OR DELETE ON "change_control_assessments" FOR EACH ROW EXECUTE FUNCTION public.prevent_change_evidence_mutation();
CREATE TRIGGER change_decisions_immutable BEFORE UPDATE OR DELETE ON "change_control_decisions" FOR EACH ROW EXECUTE FUNCTION public.prevent_change_evidence_mutation();
CREATE TRIGGER change_verifications_immutable BEFORE UPDATE OR DELETE ON "change_control_verifications" FOR EACH ROW EXECUTE FUNCTION public.prevent_change_evidence_mutation();

ALTER TABLE "change_control_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_control_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_control_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_control_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control_tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_control_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control_verifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "change_control_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "change_controls" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "change_control_assessments" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "change_control_decisions" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "change_control_tasks" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "change_control_verifications" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "change_control_sequences", "change_controls", "change_control_tasks" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "change_control_assessments", "change_control_decisions", "change_control_verifications" TO qualyra_runtime;
REVOKE DELETE ON TABLE "change_control_sequences", "change_controls", "change_control_assessments", "change_control_decisions", "change_control_tasks", "change_control_verifications" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "change_control_assessments", "change_control_decisions", "change_control_verifications" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'changes.read', 'View GMP change controls.'),
  (gen_random_uuid(), 'changes.create', 'Propose GMP change controls.'),
  (gen_random_uuid(), 'changes.assess', 'Assess change impact, risk, and implementation plans.'),
  (gen_random_uuid(), 'changes.approve', 'Approve or reject independently assessed changes.'),
  (gen_random_uuid(), 'changes.implement', 'Complete assigned change implementation tasks.'),
  (gen_random_uuid(), 'changes.verify', 'Verify change effectiveness independently.')
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
      ('Administrator', 'changes.read'), ('Administrator', 'changes.create'), ('Administrator', 'changes.assess'),
      ('Administrator', 'changes.approve'), ('Administrator', 'changes.implement'), ('Administrator', 'changes.verify'),
      ('QA Manager', 'changes.read'), ('QA Manager', 'changes.create'), ('QA Manager', 'changes.assess'),
      ('QA Manager', 'changes.approve'), ('QA Manager', 'changes.implement'), ('QA Manager', 'changes.verify'),
      ('Document Controller', 'changes.read'), ('Document Controller', 'changes.create'), ('Document Controller', 'changes.implement'),
      ('Operator', 'changes.read'), ('Operator', 'changes.create'), ('Operator', 'changes.implement'),
      ('Auditor', 'changes.read')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
