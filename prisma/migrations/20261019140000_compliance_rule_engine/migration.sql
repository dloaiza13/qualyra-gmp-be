CREATE TYPE "ComplianceEvaluationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "ComplianceEvaluationTrigger" AS ENUM ('MANUAL');
CREATE TYPE "ComplianceRuleOutcome" AS ENUM ('PASSED', 'FAILED', 'ERROR');

ALTER TABLE "compliance_findings"
  ADD COLUMN "source_reference" VARCHAR(300),
  ADD COLUMN "rule_id" UUID,
  ADD COLUMN "fingerprint" CHAR(64),
  ADD COLUMN "last_evaluation_run_id" UUID,
  ADD COLUMN "last_evaluated_at" TIMESTAMPTZ(3);

CREATE TABLE "compliance_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" VARCHAR(60) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" VARCHAR(3000) NOT NULL,
  "implementation_key" VARCHAR(100) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "severity" "ComplianceFindingSeverity" NOT NULL,
  "requirement_id" UUID NOT NULL,
  "control_id" UUID,
  "owner_user_id" UUID,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "configuration" JSONB,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_evaluation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "status" "ComplianceEvaluationStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger" "ComplianceEvaluationTrigger" NOT NULL DEFAULT 'MANUAL',
  "triggered_by_user_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "rules_evaluated" INTEGER NOT NULL DEFAULT 0,
  "violations_detected" INTEGER NOT NULL DEFAULT 0,
  "findings_created" INTEGER NOT NULL DEFAULT 0,
  "findings_reopened" INTEGER NOT NULL DEFAULT 0,
  "findings_resolved" INTEGER NOT NULL DEFAULT 0,
  "findings_unchanged" INTEGER NOT NULL DEFAULT 0,
  "error_summary" VARCHAR(3000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_evaluation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_evaluation_runs_counts_check" CHECK (
    "rules_evaluated" >= 0 AND "violations_detected" >= 0 AND
    "findings_created" >= 0 AND "findings_reopened" >= 0 AND
    "findings_resolved" >= 0 AND "findings_unchanged" >= 0
  ),
  CONSTRAINT "compliance_evaluation_runs_completion_check" CHECK (
    ("status" = 'RUNNING' AND "completed_at" IS NULL) OR
    ("status" <> 'RUNNING' AND "completed_at" IS NOT NULL)
  )
);

CREATE TABLE "compliance_rule_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "evaluation_run_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "outcome" "ComplianceRuleOutcome" NOT NULL,
  "scanned_count" INTEGER NOT NULL DEFAULT 0,
  "violation_count" INTEGER NOT NULL DEFAULT 0,
  "findings_created" INTEGER NOT NULL DEFAULT 0,
  "findings_reopened" INTEGER NOT NULL DEFAULT 0,
  "findings_resolved" INTEGER NOT NULL DEFAULT 0,
  "findings_unchanged" INTEGER NOT NULL DEFAULT 0,
  "details" JSONB,
  "error_message" VARCHAR(3000),
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_rule_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_rule_results_counts_check" CHECK (
    "scanned_count" >= 0 AND "violation_count" >= 0 AND
    "findings_created" >= 0 AND "findings_reopened" >= 0 AND
    "findings_resolved" >= 0 AND "findings_unchanged" >= 0
  )
);

CREATE UNIQUE INDEX "compliance_rules_tenant_id_id_key" ON "compliance_rules"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_rules_tenant_id_key_key" ON "compliance_rules"("tenant_id", "key");
CREATE INDEX "compliance_rules_enabled_implementation_idx" ON "compliance_rules"("tenant_id", "enabled", "implementation_key");
CREATE INDEX "compliance_rules_requirement_idx" ON "compliance_rules"("tenant_id", "requirement_id");
CREATE UNIQUE INDEX "compliance_evaluation_runs_tenant_id_id_key" ON "compliance_evaluation_runs"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_evaluation_runs_idempotency_key" ON "compliance_evaluation_runs"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "compliance_evaluation_runs_one_running_key" ON "compliance_evaluation_runs"("tenant_id") WHERE "status" = 'RUNNING';
CREATE INDEX "compliance_evaluation_runs_started_idx" ON "compliance_evaluation_runs"("tenant_id", "started_at" DESC);
CREATE UNIQUE INDEX "compliance_rule_results_tenant_id_id_key" ON "compliance_rule_results"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_rule_results_run_rule_key" ON "compliance_rule_results"("tenant_id", "evaluation_run_id", "rule_id");
CREATE INDEX "compliance_rule_results_rule_created_idx" ON "compliance_rule_results"("tenant_id", "rule_id", "created_at" DESC);
CREATE UNIQUE INDEX "compliance_findings_tenant_fingerprint_key" ON "compliance_findings"("tenant_id", "fingerprint");
CREATE INDEX "compliance_findings_rule_status_idx" ON "compliance_findings"("tenant_id", "rule_id", "status");

ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_requirement_fkey" FOREIGN KEY ("tenant_id", "requirement_id") REFERENCES "compliance_requirements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_control_fkey" FOREIGN KEY ("tenant_id", "control_id") REFERENCES "compliance_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_owner_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evaluation_runs" ADD CONSTRAINT "compliance_evaluation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evaluation_runs" ADD CONSTRAINT "compliance_evaluation_runs_triggered_by_fkey" FOREIGN KEY ("tenant_id", "triggered_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rule_results" ADD CONSTRAINT "compliance_rule_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rule_results" ADD CONSTRAINT "compliance_rule_results_run_fkey" FOREIGN KEY ("tenant_id", "evaluation_run_id") REFERENCES "compliance_evaluation_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_rule_results" ADD CONSTRAINT "compliance_rule_results_rule_fkey" FOREIGN KEY ("tenant_id", "rule_id") REFERENCES "compliance_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_rule_fkey" FOREIGN KEY ("tenant_id", "rule_id") REFERENCES "compliance_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_last_evaluation_fkey" FOREIGN KEY ("tenant_id", "last_evaluation_run_id") REFERENCES "compliance_evaluation_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_automation_check" CHECK (
  ("rule_id" IS NULL AND "fingerprint" IS NULL) OR
  ("rule_id" IS NOT NULL AND "fingerprint" IS NOT NULL)
);

ALTER TABLE "compliance_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evaluation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evaluation_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_rule_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_rule_results" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_rules" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_evaluation_runs" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_rule_results" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "compliance_rules", "compliance_evaluation_runs" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "compliance_rule_results" TO qualyra_runtime;
REVOKE DELETE ON TABLE "compliance_rules", "compliance_evaluation_runs", "compliance_rule_results" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "compliance_rule_results" FROM qualyra_runtime;
