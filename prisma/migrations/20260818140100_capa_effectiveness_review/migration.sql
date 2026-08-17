-- Phase 17 adds independent CAPA effectiveness verification and controlled
-- closure of the source deviation.
CREATE TYPE "CapaEffectivenessStatus" AS ENUM (
  'SCHEDULED',
  'COMPLETED'
);

CREATE TYPE "CapaEffectivenessDecision" AS ENUM (
  'EFFECTIVE',
  'INEFFECTIVE'
);

CREATE TABLE "capa_effectiveness_reviews" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "criterion" VARCHAR(2000) NOT NULL,
  "assigned_to_user_id" UUID NOT NULL,
  "scheduled_by_user_id" UUID NOT NULL,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "CapaEffectivenessStatus" NOT NULL DEFAULT 'SCHEDULED',
  "decision" "CapaEffectivenessDecision",
  "evidence" VARCHAR(5000),
  "completion_session_id" UUID,
  "meaning" "CapaSignatureMeaning",
  "authentication_method" "CapaAuthenticationMethod",
  "completed_at" TIMESTAMPTZ(3),
  "record_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_effectiveness_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_effectiveness_reviews_schedule_check" CHECK (
    char_length(btrim("criterion")) BETWEEN 10 AND 2000
    AND "due_at" > "created_at"
  ),
  CONSTRAINT "capa_effectiveness_reviews_state_check" CHECK (
    (
      "status" = 'SCHEDULED'
      AND "decision" IS NULL
      AND "evidence" IS NULL
      AND "completion_session_id" IS NULL
      AND "meaning" IS NULL
      AND "authentication_method" IS NULL
      AND "completed_at" IS NULL
      AND "record_hash" IS NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "decision" IS NOT NULL
      AND char_length(btrim("evidence")) BETWEEN 10 AND 5000
      AND "completion_session_id" IS NOT NULL
      AND "meaning" = 'EFFECTIVENESS_VERIFICATION'
      AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
      AND "completed_at" IS NOT NULL
      AND "record_hash" ~ '^[0-9a-f]{64}$'
    )
  )
);

CREATE UNIQUE INDEX "capa_effectiveness_reviews_tenant_id_id_key"
  ON "capa_effectiveness_reviews"("tenant_id", "id");
CREATE UNIQUE INDEX "capa_effectiveness_reviews_tenant_capa_key"
  ON "capa_effectiveness_reviews"("tenant_id", "capa_id");
CREATE INDEX "capa_effectiveness_reviews_status_due_idx"
  ON "capa_effectiveness_reviews"("tenant_id", "status", "due_at");
CREATE INDEX "capa_effectiveness_reviews_assignee_status_due_idx"
  ON "capa_effectiveness_reviews"("tenant_id", "assigned_to_user_id", "status", "due_at");

ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_tenant_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_tenant_assignee_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_tenant_scheduler_fkey"
  FOREIGN KEY ("tenant_id", "scheduled_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_completion_session_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id", "completion_session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_capa_effectiveness_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.capas capa
    WHERE capa.tenant_id = NEW.tenant_id
      AND capa.id = NEW.capa_id
      AND capa.locked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.capa_id
  ) OR EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.capa_id
      AND action.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Effectiveness review requires a locked CAPA with all actions completed.'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.capa_id
      AND action.assigned_to_user_id = NEW.assigned_to_user_id
  ) THEN
    RAISE EXCEPTION 'Effectiveness reviewer must be independent from CAPA action execution.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_effectiveness_reviews_insert_guard
BEFORE INSERT ON "capa_effectiveness_reviews"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_effectiveness_insert();

CREATE FUNCTION public.guard_capa_effectiveness_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'SCHEDULED' OR NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'An effectiveness review may only transition once from scheduled to completed.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.criterion IS DISTINCT FROM NEW.criterion
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.scheduled_by_user_id IS DISTINCT FROM NEW.scheduled_by_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Effectiveness review schedule evidence is immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.capa_id
      AND action.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'All CAPA actions must remain completed before effectiveness verification.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_effectiveness_reviews_transition_guard
BEFORE UPDATE ON "capa_effectiveness_reviews"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_effectiveness_transition();

CREATE FUNCTION public.prevent_capa_effectiveness_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'CAPA effectiveness evidence cannot be deleted.'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_capa_effectiveness_delete() FROM PUBLIC;

CREATE TRIGGER capa_effectiveness_reviews_prevent_delete
BEFORE DELETE ON "capa_effectiveness_reviews"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_capa_effectiveness_delete();

-- CLOSED uses the same immutable triage evidence as an investigation-complete
-- deviation and can only be reached through an effective CAPA review.
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
      "status" IN ('UNDER_INVESTIGATION', 'INVESTIGATION_COMPLETED', 'CLOSED')
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

  IF OLD.status IN ('UNDER_INVESTIGATION', 'INVESTIGATION_COMPLETED') THEN
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
  END IF;

  IF OLD.status = 'UNDER_INVESTIGATION' THEN
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

  IF OLD.status = 'INVESTIGATION_COMPLETED' THEN
    IF NEW.status <> 'CLOSED' OR NOT EXISTS (
      SELECT 1
      FROM public.capas capa
      JOIN public.capa_effectiveness_reviews review
        ON review.tenant_id = capa.tenant_id
        AND review.capa_id = capa.id
      WHERE capa.tenant_id = NEW.tenant_id
        AND capa.deviation_id = NEW.id
        AND review.status = 'COMPLETED'
        AND review.decision = 'EFFECTIVE'
    ) THEN
      RAISE EXCEPTION 'Effective CAPA review evidence is required to close the deviation.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Closed or cancelled deviation records are immutable.'
    USING ERRCODE = '55000';
END;
$$;

ALTER TABLE "capa_effectiveness_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_effectiveness_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_effectiveness_reviews"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "capa_effectiveness_reviews" TO qualyra_runtime;
REVOKE DELETE ON TABLE "capa_effectiveness_reviews" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'capas.schedule_effectiveness', 'Schedule independent CAPA effectiveness reviews.'),
  (gen_random_uuid(), 'capas.verify_effectiveness', 'Complete assigned CAPA effectiveness reviews.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

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
        ('Administrator', 'capas.schedule_effectiveness'),
        ('Administrator', 'capas.verify_effectiveness'),
        ('QA Manager', 'capas.schedule_effectiveness'),
        ('QA Manager', 'capas.verify_effectiveness')
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
