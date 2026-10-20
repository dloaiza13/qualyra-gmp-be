CREATE TYPE "ComplianceReadinessStatus" AS ENUM (
  'NOT_ENOUGH_DATA',
  'EXCELLENT',
  'GOOD',
  'NEEDS_ATTENTION',
  'HIGH_RISK'
);

CREATE TABLE "compliance_readiness_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "critical_penalty" DECIMAL(7,2) NOT NULL DEFAULT 15,
  "major_penalty" DECIMAL(7,2) NOT NULL DEFAULT 5,
  "minor_penalty" DECIMAL(7,2) NOT NULL DEFAULT 2,
  "observation_penalty" DECIMAL(7,2) NOT NULL DEFAULT 0.5,
  "unmapped_requirement_penalty" DECIMAL(7,2) NOT NULL DEFAULT 5,
  "missing_evidence_penalty" DECIMAL(7,2) NOT NULL DEFAULT 2,
  "excellent_minimum" DECIMAL(5,2) NOT NULL DEFAULT 90,
  "good_minimum" DECIMAL(5,2) NOT NULL DEFAULT 75,
  "needs_attention_minimum" DECIMAL(5,2) NOT NULL DEFAULT 50,
  "framework_weights" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "category_weights" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_readiness_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_readiness_policies_penalties_check" CHECK (
    "critical_penalty" >= 0 AND "major_penalty" >= 0 AND
    "minor_penalty" >= 0 AND "observation_penalty" >= 0 AND
    "critical_penalty" >= "major_penalty" AND
    "major_penalty" >= "minor_penalty" AND
    "minor_penalty" >= "observation_penalty" AND
    "unmapped_requirement_penalty" >= 0 AND
    "missing_evidence_penalty" >= 0
  ),
  CONSTRAINT "compliance_readiness_policies_thresholds_check" CHECK (
    "excellent_minimum" <= 100 AND
    "excellent_minimum" > "good_minimum" AND
    "good_minimum" > "needs_attention_minimum" AND
    "needs_attention_minimum" >= 0
  ),
  CONSTRAINT "compliance_readiness_policies_weights_check" CHECK (
    jsonb_typeof("framework_weights") = 'object' AND
    jsonb_typeof("category_weights") = 'object'
  ),
  CONSTRAINT "compliance_readiness_policies_version_check" CHECK ("version" > 0)
);

CREATE TABLE "compliance_score_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "overall_score" DECIMAL(5,2),
  "status" "ComplianceReadinessStatus" NOT NULL,
  "active_frameworks" INTEGER NOT NULL,
  "total_requirements" INTEGER NOT NULL,
  "mapped_requirements" INTEGER NOT NULL,
  "evidence_covered_requirements" INTEGER NOT NULL,
  "critical_findings" INTEGER NOT NULL,
  "major_findings" INTEGER NOT NULL,
  "minor_findings" INTEGER NOT NULL,
  "observation_findings" INTEGER NOT NULL,
  "accepted_risk_findings" INTEGER NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "calculation" JSONB NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_score_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_score_snapshots_counts_check" CHECK (
    "active_frameworks" >= 0 AND "total_requirements" >= 0 AND
    "mapped_requirements" >= 0 AND "evidence_covered_requirements" >= 0 AND
    "mapped_requirements" <= "total_requirements" AND
    "evidence_covered_requirements" <= "total_requirements" AND
    "critical_findings" >= 0 AND "major_findings" >= 0 AND
    "minor_findings" >= 0 AND "observation_findings" >= 0 AND
    "accepted_risk_findings" >= 0 AND "policy_version" > 0
  ),
  CONSTRAINT "compliance_score_snapshots_score_check" CHECK (
    ("status" = 'NOT_ENOUGH_DATA' AND "overall_score" IS NULL) OR
    ("status" <> 'NOT_ENOUGH_DATA' AND "overall_score" BETWEEN 0 AND 100)
  ),
  CONSTRAINT "compliance_score_snapshots_calculation_check" CHECK (
    jsonb_typeof("calculation") = 'object'
  )
);

CREATE UNIQUE INDEX "compliance_readiness_policies_tenant_key"
  ON "compliance_readiness_policies"("tenant_id");
CREATE UNIQUE INDEX "compliance_readiness_policies_tenant_id_id_key"
  ON "compliance_readiness_policies"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_score_snapshots_tenant_id_id_key"
  ON "compliance_score_snapshots"("tenant_id", "id");
CREATE INDEX "compliance_score_snapshots_created_idx"
  ON "compliance_score_snapshots"("tenant_id", "created_at" DESC);

ALTER TABLE "compliance_readiness_policies"
  ADD CONSTRAINT "compliance_readiness_policies_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "compliance_readiness_policies_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "compliance_readiness_policies_updater_fkey"
  FOREIGN KEY ("tenant_id", "updated_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_score_snapshots"
  ADD CONSTRAINT "compliance_score_snapshots_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "compliance_score_snapshots_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_readiness_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_readiness_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_score_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_score_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_readiness_policies"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_score_snapshots"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "compliance_readiness_policies" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "compliance_score_snapshots" TO qualyra_runtime;
REVOKE DELETE ON TABLE "compliance_readiness_policies", "compliance_score_snapshots" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "compliance_score_snapshots" FROM qualyra_runtime;
