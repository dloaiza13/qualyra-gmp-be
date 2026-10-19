CREATE TYPE "ComplianceRequirementSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION');
CREATE TYPE "ComplianceControlStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "ComplianceFindingSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION');
CREATE TYPE "ComplianceFindingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK');
ALTER TYPE "HelpGuideContext" ADD VALUE IF NOT EXISTS 'COMPLIANCE' AFTER 'OVERVIEW';

CREATE TABLE "compliance_frameworks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "description" VARCHAR(3000) NOT NULL,
  "jurisdiction" VARCHAR(120),
  "effective_date" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_frameworks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_requirements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "framework_id" UUID NOT NULL,
  "parent_requirement_id" UUID,
  "code" VARCHAR(100) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "severity" "ComplianceRequirementSeverity" NOT NULL DEFAULT 'MAJOR',
  "weight" DECIMAL(7,2) NOT NULL DEFAULT 1,
  "mandatory" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_requirements_weight_check" CHECK ("weight" > 0)
);

CREATE TABLE "compliance_controls" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(250) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "status" "ComplianceControlStatus" NOT NULL DEFAULT 'DRAFT',
  "owner_user_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_controls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_findings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "framework_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "control_id" UUID,
  "severity" "ComplianceFindingSeverity" NOT NULL,
  "status" "ComplianceFindingStatus" NOT NULL DEFAULT 'OPEN',
  "category" VARCHAR(100) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "detection_source" VARCHAR(80) NOT NULL DEFAULT 'MANUAL',
  "source_entity_type" VARCHAR(80),
  "source_entity_id" UUID,
  "owner_user_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_user_id" UUID,
  "resolution_note" VARCHAR(3000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "compliance_findings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_findings_source_pair_check" CHECK (
    ("source_entity_type" IS NULL AND "source_entity_id" IS NULL) OR
    ("source_entity_type" IS NOT NULL AND "source_entity_id" IS NOT NULL)
  ),
  CONSTRAINT "compliance_findings_resolution_check" CHECK (
    ("status" IN ('OPEN', 'IN_PROGRESS') AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL AND "resolution_note" IS NULL) OR
    ("status" IN ('RESOLVED', 'ACCEPTED_RISK') AND "resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL AND "resolution_note" IS NOT NULL)
  )
);

CREATE TABLE "compliance_control_requirements" (
  "tenant_id" UUID NOT NULL,
  "control_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_control_requirements_pkey" PRIMARY KEY ("tenant_id", "control_id", "requirement_id")
);

CREATE TABLE "compliance_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "requirement_id" UUID,
  "control_id" UUID,
  "finding_id" UUID,
  "source_entity_type" VARCHAR(80) NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "source_reference" VARCHAR(300) NOT NULL,
  "description" VARCHAR(3000) NOT NULL,
  "valid_until" DATE,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_evidence_target_check" CHECK (
    "requirement_id" IS NOT NULL OR "control_id" IS NOT NULL OR "finding_id" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "compliance_frameworks_tenant_id_id_key" ON "compliance_frameworks"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_frameworks_code_version_key" ON "compliance_frameworks"("tenant_id", "code", "version");
CREATE INDEX "compliance_frameworks_active_name_idx" ON "compliance_frameworks"("tenant_id", "active", "name");
CREATE UNIQUE INDEX "compliance_requirements_tenant_id_id_key" ON "compliance_requirements"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_requirements_framework_id_key" ON "compliance_requirements"("tenant_id", "framework_id", "id");
CREATE UNIQUE INDEX "compliance_requirements_code_key" ON "compliance_requirements"("tenant_id", "framework_id", "code");
CREATE INDEX "compliance_requirements_hierarchy_idx" ON "compliance_requirements"("tenant_id", "framework_id", "parent_requirement_id", "sort_order");
CREATE UNIQUE INDEX "compliance_controls_tenant_id_id_key" ON "compliance_controls"("tenant_id", "id");
CREATE UNIQUE INDEX "compliance_controls_code_key" ON "compliance_controls"("tenant_id", "code");
CREATE INDEX "compliance_controls_status_category_idx" ON "compliance_controls"("tenant_id", "status", "category");
CREATE UNIQUE INDEX "compliance_findings_tenant_id_id_key" ON "compliance_findings"("tenant_id", "id");
CREATE INDEX "compliance_findings_status_severity_idx" ON "compliance_findings"("tenant_id", "status", "severity", "detected_at" DESC);
CREATE INDEX "compliance_findings_framework_category_idx" ON "compliance_findings"("tenant_id", "framework_id", "category");
CREATE INDEX "compliance_findings_owner_status_idx" ON "compliance_findings"("tenant_id", "owner_user_id", "status");
CREATE INDEX "compliance_control_requirements_requirement_idx" ON "compliance_control_requirements"("tenant_id", "requirement_id");
CREATE UNIQUE INDEX "compliance_evidence_tenant_id_id_key" ON "compliance_evidence"("tenant_id", "id");
CREATE INDEX "compliance_evidence_requirement_idx" ON "compliance_evidence"("tenant_id", "requirement_id");
CREATE INDEX "compliance_evidence_control_idx" ON "compliance_evidence"("tenant_id", "control_id");
CREATE INDEX "compliance_evidence_finding_idx" ON "compliance_evidence"("tenant_id", "finding_id");
CREATE INDEX "compliance_evidence_source_idx" ON "compliance_evidence"("tenant_id", "source_entity_type", "source_entity_id");

ALTER TABLE "compliance_frameworks" ADD CONSTRAINT "compliance_frameworks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_frameworks" ADD CONSTRAINT "compliance_frameworks_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "compliance_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "compliance_requirements_framework_fkey" FOREIGN KEY ("tenant_id", "framework_id") REFERENCES "compliance_frameworks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "compliance_requirements_parent_fkey" FOREIGN KEY ("tenant_id", "framework_id", "parent_requirement_id") REFERENCES "compliance_requirements"("tenant_id", "framework_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_requirements" ADD CONSTRAINT "compliance_requirements_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_owner_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_framework_fkey" FOREIGN KEY ("tenant_id", "framework_id") REFERENCES "compliance_frameworks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_requirement_fkey" FOREIGN KEY ("tenant_id", "framework_id", "requirement_id") REFERENCES "compliance_requirements"("tenant_id", "framework_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_control_fkey" FOREIGN KEY ("tenant_id", "control_id") REFERENCES "compliance_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_owner_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_resolver_fkey" FOREIGN KEY ("tenant_id", "resolved_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_control_requirements" ADD CONSTRAINT "compliance_control_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_control_requirements" ADD CONSTRAINT "compliance_control_requirements_control_fkey" FOREIGN KEY ("tenant_id", "control_id") REFERENCES "compliance_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_control_requirements" ADD CONSTRAINT "compliance_control_requirements_requirement_fkey" FOREIGN KEY ("tenant_id", "requirement_id") REFERENCES "compliance_requirements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_requirement_fkey" FOREIGN KEY ("tenant_id", "requirement_id") REFERENCES "compliance_requirements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_control_fkey" FOREIGN KEY ("tenant_id", "control_id") REFERENCES "compliance_controls"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_finding_fkey" FOREIGN KEY ("tenant_id", "finding_id") REFERENCES "compliance_findings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_frameworks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_frameworks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_findings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_control_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_control_requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidence" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_frameworks" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_requirements" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_controls" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_findings" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_control_requirements" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "compliance_evidence" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE
  "compliance_frameworks",
  "compliance_requirements",
  "compliance_controls",
  "compliance_findings",
  "compliance_control_requirements",
  "compliance_evidence"
TO qualyra_runtime;
REVOKE DELETE ON TABLE
  "compliance_frameworks",
  "compliance_requirements",
  "compliance_controls",
  "compliance_findings",
  "compliance_control_requirements",
  "compliance_evidence"
FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "compliance_control_requirements", "compliance_evidence" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'compliance.read', 'View the organization compliance foundation and findings.'),
  (gen_random_uuid(), 'compliance.manage', 'Manage compliance controls and evidence relationships.'),
  (gen_random_uuid(), 'compliance.evaluate', 'Run deterministic compliance evaluations.'),
  (gen_random_uuid(), 'compliance.findings.manage', 'Create and manage compliance findings.'),
  (gen_random_uuid(), 'compliance.frameworks.read', 'View adopted compliance frameworks and requirements.'),
  (gen_random_uuid(), 'compliance.frameworks.manage', 'Manage adopted compliance frameworks and requirements.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

DO $$
DECLARE tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    CROSS JOIN "permissions" permission
    WHERE role.tenant_id = tenant_record.id
      AND role.is_system = true
      AND (
        (role.name IN ('Administrator', 'QA Manager') AND permission.code IN (
          'compliance.read', 'compliance.manage', 'compliance.evaluate',
          'compliance.findings.manage', 'compliance.frameworks.read', 'compliance.frameworks.manage'
        ))
        OR (role.name IN ('Document Controller', 'Auditor') AND permission.code IN (
          'compliance.read', 'compliance.frameworks.read'
        ))
      )
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
