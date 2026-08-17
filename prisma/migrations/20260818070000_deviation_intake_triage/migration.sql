-- CreateEnum
CREATE TYPE "DeviationStatus" AS ENUM (
  'REPORTED',
  'UNDER_INVESTIGATION',
  'CANCELLED'
);

CREATE TYPE "DeviationSeverity" AS ENUM (
  'MINOR',
  'MAJOR',
  'CRITICAL'
);

-- CreateTable
CREATE TABLE "deviation_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "deviation_sequences_pkey" PRIMARY KEY ("tenant_id", "year"),
  CONSTRAINT "deviation_sequences_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
  CONSTRAINT "deviation_sequences_last_number_check" CHECK ("last_number" > 0)
);

CREATE TABLE "deviations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(24) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(5000) NOT NULL,
  "area" VARCHAR(120) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "reported_by_user_id" UUID NOT NULL,
  "status" "DeviationStatus" NOT NULL DEFAULT 'REPORTED',
  "severity" "DeviationSeverity",
  "investigator_user_id" UUID,
  "investigation_due_at" TIMESTAMPTZ(3),
  "impact_assessment" VARCHAR(2000),
  "containment_action" VARCHAR(2000),
  "triaged_by_user_id" UUID,
  "triaged_at" TIMESTAMPTZ(3),
  "cancelled_by_user_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "deviations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deviations_code_check"
    CHECK ("code" ~ '^DEV-[0-9]{4}-[0-9]{4,}$'),
  CONSTRAINT "deviations_intake_check"
    CHECK (
      char_length(btrim("title")) BETWEEN 5 AND 200
      AND char_length(btrim("description")) BETWEEN 10 AND 5000
      AND char_length(btrim("area")) BETWEEN 2 AND 120
      AND "occurred_at" <= "created_at"
    ),
  CONSTRAINT "deviations_state_check"
    CHECK (
      (
        "status" = 'REPORTED'
        AND "severity" IS NULL
        AND "investigator_user_id" IS NULL
        AND "investigation_due_at" IS NULL
        AND "impact_assessment" IS NULL
        AND "containment_action" IS NULL
        AND "triaged_by_user_id" IS NULL
        AND "triaged_at" IS NULL
        AND "cancelled_by_user_id" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'UNDER_INVESTIGATION'
        AND "severity" IS NOT NULL
        AND "investigator_user_id" IS NOT NULL
        AND "investigation_due_at" IS NOT NULL
        AND char_length(btrim("impact_assessment")) BETWEEN 3 AND 2000
        AND char_length(btrim("containment_action")) BETWEEN 3 AND 2000
        AND "triaged_by_user_id" IS NOT NULL
        AND "triaged_at" IS NOT NULL
        AND "investigation_due_at" > "triaged_at"
        AND "cancelled_by_user_id" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'CANCELLED'
        AND "severity" IS NULL
        AND "investigator_user_id" IS NULL
        AND "investigation_due_at" IS NULL
        AND "impact_assessment" IS NULL
        AND "containment_action" IS NULL
        AND "triaged_by_user_id" IS NULL
        AND "triaged_at" IS NULL
        AND "cancelled_by_user_id" IS NOT NULL
        AND "cancelled_at" IS NOT NULL
        AND char_length(btrim("cancellation_reason")) BETWEEN 3 AND 500
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "deviations_tenant_id_id_key"
  ON "deviations"("tenant_id", "id");
CREATE UNIQUE INDEX "deviations_tenant_id_code_key"
  ON "deviations"("tenant_id", "code");
CREATE INDEX "deviations_tenant_status_created_idx"
  ON "deviations"("tenant_id", "status", "created_at");
CREATE INDEX "deviations_tenant_severity_due_idx"
  ON "deviations"("tenant_id", "severity", "investigation_due_at");
CREATE INDEX "deviations_tenant_investigator_status_idx"
  ON "deviations"("tenant_id", "investigator_user_id", "status");

-- AddForeignKey
ALTER TABLE "deviation_sequences"
  ADD CONSTRAINT "deviation_sequences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_tenant_id_reported_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "reported_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_tenant_id_investigator_user_id_fkey"
  FOREIGN KEY ("tenant_id", "investigator_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_tenant_id_triaged_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "triaged_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_tenant_id_cancelled_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequence numbers advance exactly once and sequence identity cannot change.
CREATE FUNCTION public.guard_deviation_sequence_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.year IS DISTINCT FROM NEW.year
    OR NEW.last_number <> OLD.last_number + 1
  THEN
    RAISE EXCEPTION 'Deviation sequence identity is immutable and must advance by one.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deviation_sequences_update_guard
BEFORE UPDATE ON "deviation_sequences"
FOR EACH ROW
EXECUTE FUNCTION public.guard_deviation_sequence_update();

-- Phase 14 allows intake to transition once to triage or cancellation.
CREATE FUNCTION public.guard_deviation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'REPORTED' THEN
    RAISE EXCEPTION 'The deviation intake and triage record is immutable after triage.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.code IS DISTINCT FROM NEW.code
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.area IS DISTINCT FROM NEW.area
    OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
    OR OLD.reported_by_user_id IS DISTINCT FROM NEW.reported_by_user_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Deviation intake evidence is immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'REPORTED' THEN
    RAISE EXCEPTION 'Deviation updates must triage or cancel the reported record.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deviations_transition_guard
BEFORE UPDATE ON "deviations"
FOR EACH ROW
EXECUTE FUNCTION public.guard_deviation_transition();

-- Tenant isolation and least-privilege runtime access.
ALTER TABLE "deviation_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deviation_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deviation_sequences"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE "deviations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deviations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deviations"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "deviation_sequences", "deviations"
  TO qualyra_runtime;
REVOKE DELETE ON TABLE "deviation_sequences", "deviations"
  FROM qualyra_runtime;

-- Add the global permission catalog entries needed by this module.
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'deviations.read', 'View deviations.'),
  (gen_random_uuid(), 'deviations.create', 'Report deviations.'),
  (gen_random_uuid(), 'deviations.triage', 'Triage and cancel reported deviations.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

-- Extend the standard roles of existing tenants without replacing custom grants.
DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    JOIN (
      VALUES
        ('Administrator', 'deviations.read'),
        ('Administrator', 'deviations.create'),
        ('Administrator', 'deviations.triage'),
        ('QA Manager', 'deviations.read'),
        ('QA Manager', 'deviations.create'),
        ('QA Manager', 'deviations.triage'),
        ('Document Controller', 'deviations.read'),
        ('Document Controller', 'deviations.create'),
        ('Operator', 'deviations.read'),
        ('Operator', 'deviations.create'),
        ('Auditor', 'deviations.read')
    ) AS grant_map(role_name, permission_code)
      ON grant_map.role_name = role.name
    JOIN "permissions" permission
      ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id
      AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END
$$;
