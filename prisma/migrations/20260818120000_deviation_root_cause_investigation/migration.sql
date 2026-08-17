-- Phase 15 completes an assigned root-cause investigation as immutable evidence.
CREATE TYPE "DeviationRootCauseMethod" AS ENUM (
  'FIVE_WHYS',
  'ISHIKAWA',
  'FAULT_TREE_ANALYSIS',
  'OTHER'
);

CREATE TYPE "DeviationSignatureMeaning" AS ENUM (
  'INVESTIGATION_COMPLETION'
);

CREATE TYPE "DeviationAuthenticationMethod" AS ENUM (
  'PASSWORD_REAUTHENTICATION'
);

CREATE TABLE "deviation_investigations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "deviation_id" UUID NOT NULL,
  "method" "DeviationRootCauseMethod" NOT NULL,
  "problem_statement" VARCHAR(2000) NOT NULL,
  "chronology" VARCHAR(5000) NOT NULL,
  "immediate_cause" VARCHAR(2000) NOT NULL,
  "root_cause" VARCHAR(5000) NOT NULL,
  "contributing_factors" VARCHAR(5000) NOT NULL,
  "product_impact" VARCHAR(5000) NOT NULL,
  "requires_capa" BOOLEAN NOT NULL,
  "capa_rationale" VARCHAR(2000) NOT NULL,
  "completed_by_user_id" UUID NOT NULL,
  "completion_session_id" UUID NOT NULL,
  "meaning" "DeviationSignatureMeaning" NOT NULL,
  "authentication_method" "DeviationAuthenticationMethod" NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deviation_investigations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deviation_investigations_evidence_check"
    CHECK (
      char_length(btrim("problem_statement")) BETWEEN 10 AND 2000
      AND char_length(btrim("chronology")) BETWEEN 10 AND 5000
      AND char_length(btrim("immediate_cause")) BETWEEN 10 AND 2000
      AND char_length(btrim("root_cause")) BETWEEN 10 AND 5000
      AND char_length(btrim("contributing_factors")) BETWEEN 3 AND 5000
      AND char_length(btrim("product_impact")) BETWEEN 10 AND 5000
      AND char_length(btrim("capa_rationale")) BETWEEN 10 AND 2000
      AND "meaning" = 'INVESTIGATION_COMPLETION'
      AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
      AND "record_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX "deviation_investigations_tenant_id_id_key"
  ON "deviation_investigations"("tenant_id", "id");
CREATE UNIQUE INDEX "deviation_investigations_tenant_deviation_key"
  ON "deviation_investigations"("tenant_id", "deviation_id");
CREATE INDEX "deviation_investigations_completer_completed_idx"
  ON "deviation_investigations"("tenant_id", "completed_by_user_id", "completed_at");
CREATE INDEX "deviation_investigations_capa_completed_idx"
  ON "deviation_investigations"("tenant_id", "requires_capa", "completed_at");

ALTER TABLE "deviation_investigations"
  ADD CONSTRAINT "deviation_investigations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviation_investigations"
  ADD CONSTRAINT "deviation_investigations_tenant_id_deviation_id_fkey"
  FOREIGN KEY ("tenant_id", "deviation_id") REFERENCES "deviations"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviation_investigations"
  ADD CONSTRAINT "deviation_investigations_tenant_id_completed_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "completed_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deviation_investigations"
  ADD CONSTRAINT "deviation_investigations_completion_session_fkey"
  FOREIGN KEY ("tenant_id", "completed_by_user_id", "completion_session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deviations" DROP CONSTRAINT "deviations_state_check";
ALTER TABLE "deviations"
  ADD CONSTRAINT "deviations_state_check"
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
      "status" IN ('UNDER_INVESTIGATION', 'INVESTIGATION_COMPLETED')
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
  );

-- Extend the deviation lifecycle while keeping intake and triage evidence frozen.
CREATE OR REPLACE FUNCTION public.guard_deviation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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

  IF OLD.status = 'REPORTED' THEN
    IF NEW.status NOT IN ('UNDER_INVESTIGATION', 'CANCELLED') THEN
      RAISE EXCEPTION 'A reported deviation may only be triaged or cancelled.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'UNDER_INVESTIGATION' THEN
    IF OLD.severity IS DISTINCT FROM NEW.severity
      OR OLD.investigator_user_id IS DISTINCT FROM NEW.investigator_user_id
      OR OLD.investigation_due_at IS DISTINCT FROM NEW.investigation_due_at
      OR OLD.impact_assessment IS DISTINCT FROM NEW.impact_assessment
      OR OLD.containment_action IS DISTINCT FROM NEW.containment_action
      OR OLD.triaged_by_user_id IS DISTINCT FROM NEW.triaged_by_user_id
      OR OLD.triaged_at IS DISTINCT FROM NEW.triaged_at
      OR OLD.cancelled_by_user_id IS DISTINCT FROM NEW.cancelled_by_user_id
      OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
      OR OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason
    THEN
      RAISE EXCEPTION 'Deviation triage evidence is immutable.'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.status <> 'INVESTIGATION_COMPLETED' OR NOT EXISTS (
      SELECT 1
      FROM public.deviation_investigations investigation
      WHERE investigation.tenant_id = NEW.tenant_id
        AND investigation.deviation_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Investigation evidence is required to complete the deviation investigation.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Completed or cancelled deviation records are immutable.'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.prevent_deviation_investigation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'deviation_investigations is append-only'
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION public.prevent_deviation_investigation_mutation() FROM PUBLIC;

CREATE TRIGGER deviation_investigations_prevent_update_delete
BEFORE UPDATE OR DELETE ON "deviation_investigations"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_deviation_investigation_mutation();

ALTER TABLE "deviation_investigations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deviation_investigations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deviation_investigations"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT ON TABLE "deviation_investigations" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "deviation_investigations" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid(), 'deviations.investigate', 'Complete assigned deviation investigations.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

-- Extend existing standard roles without replacing custom grants.
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
        ('Administrator', 'deviations.investigate'),
        ('QA Manager', 'deviations.investigate'),
        ('Document Controller', 'deviations.investigate')
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
