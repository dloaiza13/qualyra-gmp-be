-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('INTERNAL', 'SUPPLIER', 'REGULATORY', 'PROCESS');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'FOLLOW_UP', 'READY_FOR_CLOSURE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditFindingClassification" AS ENUM ('OBSERVATION', 'MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('OPEN', 'RESPONSE_SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditResponseDecision" AS ENUM ('ACCEPT', 'REQUEST_REVISION');

-- CreateEnum
CREATE TYPE "AuditSignatureMeaning" AS ENUM ('AUDIT_REPORT_COMPLETION', 'FINDING_RESPONSE', 'FINDING_RESPONSE_REVIEW', 'AUDIT_CLOSURE');

-- CreateEnum
CREATE TYPE "AuditAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

-- CreateTable
CREATE TABLE "audit_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "AuditType" NOT NULL,
    "scope" VARCHAR(5000) NOT NULL,
    "objectives" VARCHAR(3000) NOT NULL,
    "criteria" VARCHAR(3000) NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(3) NOT NULL,
    "lead_auditor_user_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PLANNED',
    "started_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_findings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "code" VARCHAR(35) NOT NULL,
    "classification" "AuditFindingClassification" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "requirement_reference" VARCHAR(1000) NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "response_due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AuditFindingStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "summary" VARCHAR(5000) NOT NULL,
    "conclusion" VARCHAR(3000) NOT NULL,
    "completed_by_user_id" UUID NOT NULL,
    "completion_session_id" UUID NOT NULL,
    "meaning" "AuditSignatureMeaning" NOT NULL DEFAULT 'AUDIT_REPORT_COMPLETION',
    "authentication_method" "AuditAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "response" VARCHAR(5000) NOT NULL,
    "root_cause" VARCHAR(3000) NOT NULL,
    "correction" VARCHAR(3000) NOT NULL,
    "corrective_action" VARCHAR(5000) NOT NULL,
    "evidence_reference" VARCHAR(3000) NOT NULL,
    "capa_id" UUID,
    "change_control_id" UUID,
    "responded_by_user_id" UUID NOT NULL,
    "response_session_id" UUID NOT NULL,
    "response_meaning" "AuditSignatureMeaning" NOT NULL DEFAULT 'FINDING_RESPONSE',
    "authentication_method" "AuditAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "responded_at" TIMESTAMPTZ(3) NOT NULL,
    "response_record_hash" CHAR(64) NOT NULL,
    "decision" "AuditResponseDecision",
    "review_comment" VARCHAR(3000),
    "reviewed_by_user_id" UUID,
    "review_session_id" UUID,
    "review_meaning" "AuditSignatureMeaning",
    "reviewed_at" TIMESTAMPTZ(3),
    "review_record_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_finding_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_closures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "conclusion" VARCHAR(3000) NOT NULL,
    "closed_by_user_id" UUID NOT NULL,
    "closure_session_id" UUID NOT NULL,
    "meaning" "AuditSignatureMeaning" NOT NULL DEFAULT 'AUDIT_CLOSURE',
    "authentication_method" "AuditAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "closed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audits_status_scheduled_end_idx" ON "audits"("tenant_id", "status", "scheduled_end_at");

-- CreateIndex
CREATE INDEX "audits_created_idx" ON "audits"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audits_tenant_id_id_key" ON "audits"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audits_tenant_id_code_key" ON "audits"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "audit_findings_responsible_status_due_idx" ON "audit_findings"("tenant_id", "responsible_user_id", "status", "response_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_tenant_id_id_key" ON "audit_findings"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_audit_sequence_key" ON "audit_findings"("tenant_id", "audit_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_tenant_code_key" ON "audit_findings"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "audit_reports_tenant_id_id_key" ON "audit_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_reports_audit_key" ON "audit_reports"("tenant_id", "audit_id");

-- CreateIndex
CREATE INDEX "audit_finding_responses_finding_idx" ON "audit_finding_responses"("tenant_id", "finding_id", "responded_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_responses_tenant_id_id_key" ON "audit_finding_responses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_responses_attempt_key" ON "audit_finding_responses"("tenant_id", "finding_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "audit_closures_tenant_id_id_key" ON "audit_closures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_closures_audit_key" ON "audit_closures"("tenant_id", "audit_id");

-- AddForeignKey
ALTER TABLE "audit_sequences" ADD CONSTRAINT "audit_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_lead_auditor_user_id_fkey" FOREIGN KEY ("tenant_id", "lead_auditor_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_reviewer_user_id_fkey" FOREIGN KEY ("tenant_id", "reviewer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_tenant_id_cancelled_by_user_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_tenant_id_audit_id_fkey" FOREIGN KEY ("tenant_id", "audit_id") REFERENCES "audits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_tenant_id_responsible_user_id_fkey" FOREIGN KEY ("tenant_id", "responsible_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_tenant_id_audit_id_fkey" FOREIGN KEY ("tenant_id", "audit_id") REFERENCES "audits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_tenant_id_completed_by_user_id_fkey" FOREIGN KEY ("tenant_id", "completed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_tenant_id_completed_by_user_id_completion_se_fkey" FOREIGN KEY ("tenant_id", "completed_by_user_id", "completion_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_finding_id_fkey" FOREIGN KEY ("tenant_id", "finding_id") REFERENCES "audit_findings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_capa_id_fkey" FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_change_control_id_fkey" FOREIGN KEY ("tenant_id", "change_control_id") REFERENCES "change_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_responded_by_user_id_fkey" FOREIGN KEY ("tenant_id", "responded_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_reviewed_by_user_id_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_responded_by_user_id_res_fkey" FOREIGN KEY ("tenant_id", "responded_by_user_id", "response_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_finding_responses_tenant_id_reviewed_by_user_id_revi_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id", "review_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_closures" ADD CONSTRAINT "audit_closures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_closures" ADD CONSTRAINT "audit_closures_tenant_id_audit_id_fkey" FOREIGN KEY ("tenant_id", "audit_id") REFERENCES "audits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_closures" ADD CONSTRAINT "audit_closures_tenant_id_closed_by_user_id_fkey" FOREIGN KEY ("tenant_id", "closed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_closures" ADD CONSTRAINT "audit_closures_tenant_id_closed_by_user_id_closure_session_fkey" FOREIGN KEY ("tenant_id", "closed_by_user_id", "closure_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audits" ADD CONSTRAINT "audits_schedule_check" CHECK (scheduled_end_at > scheduled_start_at);
ALTER TABLE "audits" ADD CONSTRAINT "audits_independent_reviewer_check" CHECK (lead_auditor_user_id <> reviewer_user_id);
ALTER TABLE "audits" ADD CONSTRAINT "audits_started_check" CHECK ((status = 'PLANNED' AND started_at IS NULL) OR status IN ('CANCELLED') OR started_at IS NOT NULL);
ALTER TABLE "audits" ADD CONSTRAINT "audits_cancellation_check" CHECK (
  (status = 'CANCELLED' AND cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
  OR (status <> 'CANCELLED' AND cancelled_by_user_id IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
);
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_sequence_check" CHECK (sequence_number > 0);
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_response_attempt_check" CHECK (attempt_number > 0);
ALTER TABLE "audit_finding_responses" ADD CONSTRAINT "audit_response_review_check" CHECK (
  (decision IS NULL AND review_comment IS NULL AND reviewed_by_user_id IS NULL AND review_session_id IS NULL AND review_meaning IS NULL AND reviewed_at IS NULL AND review_record_hash IS NULL)
  OR (decision IS NOT NULL AND review_comment IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND review_session_id IS NOT NULL AND review_meaning = 'FINDING_RESPONSE_REVIEW' AND reviewed_at IS NOT NULL AND review_record_hash IS NOT NULL)
);
CREATE UNIQUE INDEX "audit_finding_responses_one_pending_idx" ON "audit_finding_responses" (tenant_id, finding_id) WHERE decision IS NULL;

CREATE FUNCTION public.guard_audit_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.type, NEW.scope, NEW.objectives, NEW.criteria,
         NEW.scheduled_start_at, NEW.scheduled_end_at, NEW.lead_auditor_user_id, NEW.reviewer_user_id,
         NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.type, OLD.scope, OLD.objectives, OLD.criteria,
         OLD.scheduled_start_at, OLD.scheduled_end_at, OLD.lead_auditor_user_id, OLD.reviewer_user_id,
         OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The approved audit plan is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('FOLLOW_UP', 'READY_FOR_CLOSURE')) OR
    (OLD.status = 'FOLLOW_UP' AND NEW.status = 'READY_FOR_CLOSURE') OR
    (OLD.status = 'READY_FOR_CLOSURE' AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'Invalid audit lifecycle transition.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_transition() FROM PUBLIC;

CREATE FUNCTION public.guard_audit_finding_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.audits audit
      WHERE audit.tenant_id = NEW.tenant_id AND audit.id = NEW.audit_id
        AND audit.status = 'IN_PROGRESS' AND audit.lead_auditor_user_id = NEW.created_by_user_id
    ) THEN
      RAISE EXCEPTION 'Findings may only be recorded by the lead auditor during execution.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.audit_id, NEW.sequence_number, NEW.code, NEW.classification, NEW.title,
         NEW.description, NEW.requirement_reference, NEW.responsible_user_id, NEW.response_due_at,
         NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.audit_id, OLD.sequence_number, OLD.code, OLD.classification, OLD.title,
         OLD.description, OLD.requirement_reference, OLD.responsible_user_id, OLD.response_due_at,
         OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Audit finding definitions are immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'OPEN' AND NEW.status = 'RESPONSE_SUBMITTED') OR
    (OLD.status = 'RESPONSE_SUBMITTED' AND NEW.status IN ('OPEN', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'Invalid audit finding transition.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_finding_mutation() FROM PUBLIC;

CREATE FUNCTION public.guard_audit_report_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audits audit
    WHERE audit.tenant_id = NEW.tenant_id AND audit.id = NEW.audit_id
      AND audit.status = 'IN_PROGRESS' AND audit.lead_auditor_user_id = NEW.completed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the lead auditor may complete an in-progress report.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_report_insert() FROM PUBLIC;

CREATE FUNCTION public.guard_audit_response_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_attempt integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(response.attempt_number), 0) + 1 INTO expected_attempt
    FROM public.audit_finding_responses response
    WHERE response.tenant_id = NEW.tenant_id AND response.finding_id = NEW.finding_id;
    IF NEW.attempt_number <> expected_attempt OR NOT EXISTS (
      SELECT 1 FROM public.audit_findings finding
      JOIN public.audits audit ON audit.tenant_id = finding.tenant_id AND audit.id = finding.audit_id
      WHERE finding.tenant_id = NEW.tenant_id AND finding.id = NEW.finding_id
        AND finding.status = 'OPEN' AND finding.responsible_user_id = NEW.responded_by_user_id
        AND audit.status = 'FOLLOW_UP'
    ) THEN
      RAISE EXCEPTION 'Only the responsible user may submit the next response attempt.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.finding_id, NEW.attempt_number, NEW.response, NEW.root_cause, NEW.correction,
         NEW.corrective_action, NEW.evidence_reference, NEW.capa_id, NEW.change_control_id,
         NEW.responded_by_user_id, NEW.response_session_id, NEW.response_meaning,
         NEW.authentication_method, NEW.responded_at, NEW.response_record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.finding_id, OLD.attempt_number, OLD.response, OLD.root_cause, OLD.correction,
         OLD.corrective_action, OLD.evidence_reference, OLD.capa_id, OLD.change_control_id,
         OLD.responded_by_user_id, OLD.response_session_id, OLD.response_meaning,
         OLD.authentication_method, OLD.responded_at, OLD.response_record_hash, OLD.created_at)
     OR OLD.decision IS NOT NULL OR NEW.decision IS NULL THEN
    RAISE EXCEPTION 'Signed audit responses are immutable and may be reviewed once.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_response_mutation() FROM PUBLIC;

CREATE FUNCTION public.guard_audit_closure_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audits audit
    WHERE audit.tenant_id = NEW.tenant_id AND audit.id = NEW.audit_id
      AND audit.status = 'READY_FOR_CLOSURE' AND audit.reviewer_user_id = NEW.closed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the independent reviewer may close a ready audit.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_closure_insert() FROM PUBLIC;

CREATE FUNCTION public.prevent_audit_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Signed audit records are immutable.' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_audit_record_mutation() FROM PUBLIC;

CREATE TRIGGER audits_transition_guard BEFORE UPDATE ON "audits" FOR EACH ROW EXECUTE FUNCTION public.guard_audit_transition();
CREATE TRIGGER audit_findings_mutation_guard BEFORE INSERT OR UPDATE ON "audit_findings" FOR EACH ROW EXECUTE FUNCTION public.guard_audit_finding_mutation();
CREATE TRIGGER audit_reports_insert_guard BEFORE INSERT ON "audit_reports" FOR EACH ROW EXECUTE FUNCTION public.guard_audit_report_insert();
CREATE TRIGGER audit_responses_mutation_guard BEFORE INSERT OR UPDATE ON "audit_finding_responses" FOR EACH ROW EXECUTE FUNCTION public.guard_audit_response_mutation();
CREATE TRIGGER audit_closures_insert_guard BEFORE INSERT ON "audit_closures" FOR EACH ROW EXECUTE FUNCTION public.guard_audit_closure_insert();
CREATE TRIGGER audit_reports_immutable BEFORE UPDATE OR DELETE ON "audit_reports" FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_record_mutation();
CREATE TRIGGER audit_closures_immutable BEFORE UPDATE OR DELETE ON "audit_closures" FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_record_mutation();
CREATE TRIGGER audit_responses_delete_guard BEFORE DELETE ON "audit_finding_responses" FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_record_mutation();

ALTER TABLE "audit_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_findings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_finding_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_finding_responses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_closures" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "audit_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "audits" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "audit_findings" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "audit_reports" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "audit_finding_responses" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "audit_closures" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "audit_sequences", "audits", "audit_findings", "audit_finding_responses" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "audit_reports", "audit_closures" TO qualyra_runtime;
REVOKE DELETE ON TABLE "audit_sequences", "audits", "audit_findings", "audit_reports", "audit_finding_responses", "audit_closures" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "audit_reports", "audit_closures" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'audits.read', 'View GMP audits, findings, and signed evidence.'),
  (gen_random_uuid(), 'audits.plan', 'Plan GMP audits and assign independent participants.'),
  (gen_random_uuid(), 'audits.execute', 'Execute assigned audits and complete signed reports.'),
  (gen_random_uuid(), 'audits.respond', 'Submit authenticated responses to assigned findings.'),
  (gen_random_uuid(), 'audits.review', 'Review finding responses independently.'),
  (gen_random_uuid(), 'audits.close', 'Sign independent GMP audit closure.')
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
      ('Administrator', 'audits.read'), ('Administrator', 'audits.plan'), ('Administrator', 'audits.execute'),
      ('Administrator', 'audits.respond'), ('Administrator', 'audits.review'), ('Administrator', 'audits.close'),
      ('QA Manager', 'audits.read'), ('QA Manager', 'audits.plan'), ('QA Manager', 'audits.execute'),
      ('QA Manager', 'audits.respond'), ('QA Manager', 'audits.review'), ('QA Manager', 'audits.close'),
      ('Auditor', 'audits.read'), ('Auditor', 'audits.plan'), ('Auditor', 'audits.execute'), ('Auditor', 'audits.review'),
      ('Document Controller', 'audits.read'), ('Document Controller', 'audits.respond'),
      ('Operator', 'audits.read'), ('Operator', 'audits.respond')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
