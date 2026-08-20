CREATE TYPE "ProductRecallActionType" AS ENUM ('RECALL', 'MARKET_WITHDRAWAL', 'FIELD_CORRECTION', 'SAFETY_NOTICE', 'STOCK_RECOVERY');
CREATE TYPE "ProductRecallStatus" AS ENUM ('REPORTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_EXECUTION', 'CLOSED', 'CANCELLED');
CREATE TYPE "RecallClassification" AS ENUM ('CLASS_I', 'CLASS_II', 'CLASS_III', 'UNCLASSIFIED');
CREATE TYPE "RecallDepth" AS ENUM ('CONSUMER', 'RETAIL', 'WHOLESALE', 'INTERNAL');
CREATE TYPE "RecallUpdateType" AS ENUM ('EXECUTION_STARTED', 'ACCOUNT_NOTIFICATION', 'PRODUCT_RECOVERY', 'PRODUCT_DESTRUCTION', 'REGULATORY_COMMUNICATION', 'OTHER');
CREATE TYPE "RecallSignatureMeaning" AS ENUM ('RISK_ASSESSMENT', 'ACTION_DECISION', 'RECONCILIATION_CLOSURE');
CREATE TYPE "RecallAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

CREATE TABLE "recall_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "recall_sequences_pkey" PRIMARY KEY ("tenant_id", "year")
);

CREATE TABLE "product_recalls" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(25) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "action_type" "ProductRecallActionType" NOT NULL,
  "source_complaint_id" UUID,
  "source_reference" VARCHAR(1000) NOT NULL,
  "product_name" VARCHAR(200) NOT NULL,
  "product_code" VARCHAR(100) NOT NULL,
  "lot_numbers" TEXT[] NOT NULL,
  "country_codes" TEXT[] NOT NULL,
  "reason" VARCHAR(5000) NOT NULL,
  "distribution_start_date" DATE,
  "distribution_end_date" DATE,
  "total_distributed_units" INTEGER NOT NULL,
  "target_close_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "ProductRecallStatus" NOT NULL DEFAULT 'REPORTED',
  "approver_user_id" UUID,
  "reported_by_user_id" UUID NOT NULL,
  "cancelled_by_user_id" UUID,
  "cancellation_reason" VARCHAR(1000),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_recalls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_recalls_lot_country_check" CHECK (cardinality("lot_numbers") > 0 AND cardinality("country_codes") > 0),
  CONSTRAINT "product_recalls_dates_check" CHECK ("distribution_start_date" IS NULL OR "distribution_end_date" IS NULL OR "distribution_end_date" >= "distribution_start_date"),
  CONSTRAINT "product_recalls_units_check" CHECK ("total_distributed_units" > 0),
  CONSTRAINT "product_recalls_assignment_check" CHECK (
    ("status" = 'REPORTED' AND "approver_user_id" IS NULL)
    OR ("status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_EXECUTION', 'CLOSED') AND "approver_user_id" IS NOT NULL)
    OR "status" = 'CANCELLED'
  ),
  CONSTRAINT "product_recalls_cancellation_check" CHECK (
    ("status" <> 'CANCELLED' AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL)
  )
);

CREATE TABLE "recall_risk_assessments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "recall_id" UUID NOT NULL,
  "classification" "RecallClassification" NOT NULL,
  "depth" "RecallDepth" NOT NULL,
  "health_hazard" VARCHAR(5000) NOT NULL,
  "scope_rationale" VARCHAR(3000) NOT NULL,
  "regulatory_reporting_required" BOOLEAN NOT NULL,
  "communication_plan" VARCHAR(3000) NOT NULL,
  "recommended_action" VARCHAR(3000) NOT NULL,
  "assessed_by_user_id" UUID NOT NULL,
  "assessment_session_id" UUID NOT NULL,
  "meaning" "RecallSignatureMeaning" NOT NULL DEFAULT 'RISK_ASSESSMENT',
  "authentication_method" "RecallAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "assessed_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recall_risk_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recall_decisions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "recall_id" UUID NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "rationale" VARCHAR(3000) NOT NULL,
  "authority_reference" VARCHAR(2000) NOT NULL,
  "decided_by_user_id" UUID NOT NULL,
  "decision_session_id" UUID NOT NULL,
  "meaning" "RecallSignatureMeaning" NOT NULL DEFAULT 'ACTION_DECISION',
  "authentication_method" "RecallAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recall_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recall_execution_updates" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "recall_id" UUID NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "update_type" "RecallUpdateType" NOT NULL,
  "note" VARCHAR(3000) NOT NULL,
  "evidence_reference" VARCHAR(2000) NOT NULL,
  "cumulative_notified_accounts" INTEGER NOT NULL,
  "cumulative_responding_accounts" INTEGER NOT NULL,
  "cumulative_recovered_units" INTEGER NOT NULL,
  "cumulative_destroyed_units" INTEGER NOT NULL,
  "recorded_by_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recall_execution_updates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recall_execution_updates_counts_check" CHECK (
    "cumulative_notified_accounts" >= 0
    AND "cumulative_responding_accounts" >= 0
    AND "cumulative_recovered_units" >= 0
    AND "cumulative_destroyed_units" >= 0
    AND "cumulative_responding_accounts" <= "cumulative_notified_accounts"
    AND "cumulative_destroyed_units" <= "cumulative_recovered_units"
  )
);

CREATE TABLE "recall_closures" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "recall_id" UUID NOT NULL,
  "effectiveness_summary" VARCHAR(5000) NOT NULL,
  "reconciliation_summary" VARCHAR(5000) NOT NULL,
  "final_notified_accounts" INTEGER NOT NULL,
  "final_responding_accounts" INTEGER NOT NULL,
  "final_recovered_units" INTEGER NOT NULL,
  "final_destroyed_units" INTEGER NOT NULL,
  "disposition_evidence" VARCHAR(3000) NOT NULL,
  "regulatory_closure_reference" VARCHAR(2000) NOT NULL,
  "closed_by_user_id" UUID NOT NULL,
  "closure_session_id" UUID NOT NULL,
  "meaning" "RecallSignatureMeaning" NOT NULL DEFAULT 'RECONCILIATION_CLOSURE',
  "authentication_method" "RecallAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "closed_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recall_closures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recall_closures_counts_check" CHECK (
    "final_notified_accounts" >= 0
    AND "final_responding_accounts" >= 0
    AND "final_recovered_units" >= 0
    AND "final_destroyed_units" >= 0
    AND "final_responding_accounts" <= "final_notified_accounts"
    AND "final_destroyed_units" <= "final_recovered_units"
  )
);

CREATE UNIQUE INDEX "product_recalls_tenant_id_id_key" ON "product_recalls"("tenant_id", "id");
CREATE UNIQUE INDEX "product_recalls_tenant_code_key" ON "product_recalls"("tenant_id", "code");
CREATE INDEX "product_recalls_status_due_idx" ON "product_recalls"("tenant_id", "status", "target_close_at");
CREATE INDEX "product_recalls_product_idx" ON "product_recalls"("tenant_id", "product_code");
CREATE INDEX "product_recalls_complaint_idx" ON "product_recalls"("tenant_id", "source_complaint_id");
CREATE UNIQUE INDEX "recall_risk_assessments_tenant_id_id_key" ON "recall_risk_assessments"("tenant_id", "id");
CREATE UNIQUE INDEX "recall_risk_assessments_recall_key" ON "recall_risk_assessments"("tenant_id", "recall_id");
CREATE UNIQUE INDEX "recall_decisions_tenant_id_id_key" ON "recall_decisions"("tenant_id", "id");
CREATE UNIQUE INDEX "recall_decisions_recall_key" ON "recall_decisions"("tenant_id", "recall_id");
CREATE UNIQUE INDEX "recall_execution_updates_tenant_id_id_key" ON "recall_execution_updates"("tenant_id", "id");
CREATE UNIQUE INDEX "recall_execution_updates_sequence_key" ON "recall_execution_updates"("tenant_id", "recall_id", "sequence_number");
CREATE INDEX "recall_execution_updates_recorded_idx" ON "recall_execution_updates"("tenant_id", "recall_id", "recorded_at");
CREATE UNIQUE INDEX "recall_closures_tenant_id_id_key" ON "recall_closures"("tenant_id", "id");
CREATE UNIQUE INDEX "recall_closures_recall_key" ON "recall_closures"("tenant_id", "recall_id");

ALTER TABLE "recall_sequences" ADD CONSTRAINT "recall_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_source_complaint_id_fkey" FOREIGN KEY ("tenant_id", "source_complaint_id") REFERENCES "product_complaints"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_approver_user_id_fkey" FOREIGN KEY ("tenant_id", "approver_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_reported_by_user_id_fkey" FOREIGN KEY ("tenant_id", "reported_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_cancelled_by_user_id_fkey" FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_risk_assessments" ADD CONSTRAINT "recall_risk_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_risk_assessments" ADD CONSTRAINT "recall_risk_assessments_tenant_id_recall_id_fkey" FOREIGN KEY ("tenant_id", "recall_id") REFERENCES "product_recalls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_risk_assessments" ADD CONSTRAINT "recall_assessment_signer_fkey" FOREIGN KEY ("tenant_id", "assessed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_risk_assessments" ADD CONSTRAINT "recall_assessment_session_fkey" FOREIGN KEY ("tenant_id", "assessed_by_user_id", "assessment_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_decisions" ADD CONSTRAINT "recall_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_decisions" ADD CONSTRAINT "recall_decisions_tenant_id_recall_id_fkey" FOREIGN KEY ("tenant_id", "recall_id") REFERENCES "product_recalls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_decisions" ADD CONSTRAINT "recall_decision_signer_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_decisions" ADD CONSTRAINT "recall_decision_session_fkey" FOREIGN KEY ("tenant_id", "decided_by_user_id", "decision_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_execution_updates" ADD CONSTRAINT "recall_execution_updates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_execution_updates" ADD CONSTRAINT "recall_execution_updates_tenant_id_recall_id_fkey" FOREIGN KEY ("tenant_id", "recall_id") REFERENCES "product_recalls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_execution_updates" ADD CONSTRAINT "recall_execution_recorder_fkey" FOREIGN KEY ("tenant_id", "recorded_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_closures" ADD CONSTRAINT "recall_closures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_closures" ADD CONSTRAINT "recall_closures_tenant_id_recall_id_fkey" FOREIGN KEY ("tenant_id", "recall_id") REFERENCES "product_recalls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_closures" ADD CONSTRAINT "recall_closure_signer_fkey" FOREIGN KEY ("tenant_id", "closed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recall_closures" ADD CONSTRAINT "recall_closure_session_fkey" FOREIGN KEY ("tenant_id", "closed_by_user_id", "closure_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_product_recall_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.action_type, NEW.source_complaint_id,
         NEW.source_reference, NEW.product_name, NEW.product_code, NEW.lot_numbers,
         NEW.country_codes, NEW.reason, NEW.distribution_start_date, NEW.distribution_end_date,
         NEW.total_distributed_units, NEW.target_close_at, NEW.reported_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.action_type, OLD.source_complaint_id,
         OLD.source_reference, OLD.product_name, OLD.product_code, OLD.lot_numbers,
         OLD.country_codes, OLD.reason, OLD.distribution_start_date, OLD.distribution_end_date,
         OLD.total_distributed_units, OLD.target_close_at, OLD.reported_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The field action intake is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('REJECTED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal field actions are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REPORTED' AND NEW.status = 'PENDING_APPROVAL' AND EXISTS (
    SELECT 1 FROM public.recall_risk_assessments a
    WHERE a.tenant_id = NEW.tenant_id AND a.recall_id = NEW.id
      AND a.assessed_by_user_id <> NEW.approver_user_id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'REJECTED') AND EXISTS (
    SELECT 1 FROM public.recall_decisions d
    WHERE d.tenant_id = NEW.tenant_id AND d.recall_id = NEW.id
      AND d.decided_by_user_id = NEW.approver_user_id
      AND ((d.approved AND NEW.status = 'APPROVED') OR (NOT d.approved AND NEW.status = 'REJECTED'))
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'IN_EXECUTION' AND EXISTS (
    SELECT 1 FROM public.recall_execution_updates u
    WHERE u.tenant_id = NEW.tenant_id AND u.recall_id = NEW.id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'IN_EXECUTION' AND NEW.status = 'CLOSED' AND EXISTS (
    SELECT 1 FROM public.recall_closures c
    WHERE c.tenant_id = NEW.tenant_id AND c.recall_id = NEW.id
      AND c.closed_by_user_id = NEW.approver_user_id
  ) THEN RETURN NEW; END IF;
  IF OLD.status = 'REPORTED' AND NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid field action lifecycle transition.' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.guard_recall_assessment_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_recalls r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.recall_id AND r.status = 'REPORTED'
  ) THEN RAISE EXCEPTION 'Only reported field actions may be assessed.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_recall_decision_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_recalls r
    JOIN public.recall_risk_assessments a ON a.tenant_id = r.tenant_id AND a.recall_id = r.id
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.recall_id
      AND r.status = 'PENDING_APPROVAL' AND r.approver_user_id = NEW.decided_by_user_id
      AND a.assessed_by_user_id <> NEW.decided_by_user_id
  ) THEN RAISE EXCEPTION 'Only the independent assigned approver may sign this decision.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_recall_execution_update_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE previous_update public.recall_execution_updates%ROWTYPE;
DECLARE distributed_units INTEGER;
BEGIN
  SELECT r.total_distributed_units INTO distributed_units
  FROM public.product_recalls r
  WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.recall_id AND r.status IN ('APPROVED', 'IN_EXECUTION');
  IF distributed_units IS NULL THEN
    RAISE EXCEPTION 'Execution evidence requires an approved field action.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO previous_update FROM public.recall_execution_updates u
  WHERE u.tenant_id = NEW.tenant_id AND u.recall_id = NEW.recall_id
  ORDER BY u.sequence_number DESC LIMIT 1;
  IF NEW.sequence_number <> COALESCE(previous_update.sequence_number, 0) + 1
     OR NEW.cumulative_notified_accounts < COALESCE(previous_update.cumulative_notified_accounts, 0)
     OR NEW.cumulative_responding_accounts < COALESCE(previous_update.cumulative_responding_accounts, 0)
     OR NEW.cumulative_recovered_units < COALESCE(previous_update.cumulative_recovered_units, 0)
     OR NEW.cumulative_destroyed_units < COALESCE(previous_update.cumulative_destroyed_units, 0)
     OR NEW.cumulative_recovered_units > distributed_units THEN
    RAISE EXCEPTION 'Execution counters must be monotonic and reconcilable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_recall_closure_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE latest public.recall_execution_updates%ROWTYPE;
DECLARE recall_record public.product_recalls%ROWTYPE;
BEGIN
  SELECT * INTO recall_record FROM public.product_recalls r
  WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.recall_id AND r.status = 'IN_EXECUTION';
  SELECT * INTO latest FROM public.recall_execution_updates u
  WHERE u.tenant_id = NEW.tenant_id AND u.recall_id = NEW.recall_id
  ORDER BY u.sequence_number DESC LIMIT 1;
  IF recall_record.id IS NULL OR latest.id IS NULL OR recall_record.approver_user_id <> NEW.closed_by_user_id
     OR NEW.final_notified_accounts < latest.cumulative_notified_accounts
     OR NEW.final_responding_accounts < latest.cumulative_responding_accounts
     OR NEW.final_recovered_units < latest.cumulative_recovered_units
     OR NEW.final_destroyed_units < latest.cumulative_destroyed_units
     OR NEW.final_recovered_units > recall_record.total_distributed_units THEN
    RAISE EXCEPTION 'Closure requires independent approval and reconciled final counters.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_recall_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Controlled field action records cannot be changed or deleted.' USING ERRCODE = '55000'; END;
$$;

CREATE TRIGGER product_recalls_mutation_guard BEFORE UPDATE ON "product_recalls" FOR EACH ROW EXECUTE FUNCTION public.guard_product_recall_mutation();
CREATE TRIGGER product_recalls_delete_guard BEFORE DELETE ON "product_recalls" FOR EACH ROW EXECUTE FUNCTION public.prevent_recall_record_mutation();
CREATE TRIGGER recall_risk_assessments_insert_guard BEFORE INSERT ON "recall_risk_assessments" FOR EACH ROW EXECUTE FUNCTION public.guard_recall_assessment_insert();
CREATE TRIGGER recall_risk_assessments_immutable BEFORE UPDATE OR DELETE ON "recall_risk_assessments" FOR EACH ROW EXECUTE FUNCTION public.prevent_recall_record_mutation();
CREATE TRIGGER recall_decisions_insert_guard BEFORE INSERT ON "recall_decisions" FOR EACH ROW EXECUTE FUNCTION public.guard_recall_decision_insert();
CREATE TRIGGER recall_decisions_immutable BEFORE UPDATE OR DELETE ON "recall_decisions" FOR EACH ROW EXECUTE FUNCTION public.prevent_recall_record_mutation();
CREATE TRIGGER recall_execution_updates_insert_guard BEFORE INSERT ON "recall_execution_updates" FOR EACH ROW EXECUTE FUNCTION public.guard_recall_execution_update_insert();
CREATE TRIGGER recall_execution_updates_immutable BEFORE UPDATE OR DELETE ON "recall_execution_updates" FOR EACH ROW EXECUTE FUNCTION public.prevent_recall_record_mutation();
CREATE TRIGGER recall_closures_insert_guard BEFORE INSERT ON "recall_closures" FOR EACH ROW EXECUTE FUNCTION public.guard_recall_closure_insert();
CREATE TRIGGER recall_closures_immutable BEFORE UPDATE OR DELETE ON "recall_closures" FOR EACH ROW EXECUTE FUNCTION public.prevent_recall_record_mutation();

REVOKE ALL ON FUNCTION public.guard_product_recall_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_recall_assessment_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_recall_decision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_recall_execution_update_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_recall_closure_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_recall_record_mutation() FROM PUBLIC;

ALTER TABLE "recall_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_recalls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_recalls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "recall_risk_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_risk_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "recall_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "recall_execution_updates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_execution_updates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "recall_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_closures" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "product_recalls" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "recall_risk_assessments" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "recall_decisions" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "recall_execution_updates" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "recall_closures" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "recall_sequences", "product_recalls" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "recall_risk_assessments", "recall_decisions", "recall_execution_updates", "recall_closures" TO qualyra_runtime;
REVOKE DELETE ON TABLE "recall_sequences", "product_recalls", "recall_risk_assessments", "recall_decisions", "recall_execution_updates", "recall_closures" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "recall_risk_assessments", "recall_decisions", "recall_execution_updates", "recall_closures" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'recalls.read', 'View controlled recalls and field-action evidence.'),
  (gen_random_uuid(), 'recalls.create', 'Report controlled recalls and field actions.'),
  (gen_random_uuid(), 'recalls.assess', 'Complete and sign field-action risk assessments.'),
  (gen_random_uuid(), 'recalls.approve', 'Independently approve or reject field actions.'),
  (gen_random_uuid(), 'recalls.execute', 'Record append-only execution and reconciliation evidence.'),
  (gen_random_uuid(), 'recalls.close', 'Independently sign field-action reconciliation and closure.'),
  (gen_random_uuid(), 'recalls.cancel', 'Cancel invalid field-action records before assessment.')
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
      ('Administrator', 'recalls.read'), ('Administrator', 'recalls.create'), ('Administrator', 'recalls.assess'), ('Administrator', 'recalls.approve'), ('Administrator', 'recalls.execute'), ('Administrator', 'recalls.close'), ('Administrator', 'recalls.cancel'),
      ('QA Manager', 'recalls.read'), ('QA Manager', 'recalls.create'), ('QA Manager', 'recalls.assess'), ('QA Manager', 'recalls.approve'), ('QA Manager', 'recalls.execute'), ('QA Manager', 'recalls.close'), ('QA Manager', 'recalls.cancel'),
      ('Document Controller', 'recalls.read'), ('Document Controller', 'recalls.create'),
      ('Operator', 'recalls.read'), ('Operator', 'recalls.create'), ('Operator', 'recalls.execute'),
      ('Auditor', 'recalls.read'), ('Auditor', 'recalls.approve'), ('Auditor', 'recalls.close')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
