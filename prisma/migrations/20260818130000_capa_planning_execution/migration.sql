-- Phase 16 introduces immutable CAPA plans and authenticated action completion.
CREATE TYPE "CapaActionType" AS ENUM (
  'CORRECTIVE',
  'PREVENTIVE'
);

CREATE TYPE "CapaActionStatus" AS ENUM (
  'OPEN',
  'COMPLETED'
);

CREATE TYPE "CapaSignatureMeaning" AS ENUM (
  'ACTION_COMPLETION'
);

CREATE TYPE "CapaAuthenticationMethod" AS ENUM (
  'PASSWORD_REAUTHENTICATION'
);

CREATE TABLE "capa_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "capa_sequences_pkey" PRIMARY KEY ("tenant_id", "year"),
  CONSTRAINT "capa_sequences_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
  CONSTRAINT "capa_sequences_last_number_check" CHECK ("last_number" > 0)
);

CREATE TABLE "capas" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "deviation_id" UUID NOT NULL,
  "investigation_id" UUID NOT NULL,
  "code" VARCHAR(25) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "objective" VARCHAR(2000) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capas_code_check" CHECK ("code" ~ '^CAPA-[0-9]{4}-[0-9]{4,}$'),
  CONSTRAINT "capas_plan_check" CHECK (
    char_length(btrim("title")) BETWEEN 5 AND 200
    AND char_length(btrim("objective")) BETWEEN 10 AND 2000
  )
);

CREATE TABLE "capa_actions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "type" "CapaActionType" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "assigned_to_user_id" UUID NOT NULL,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "CapaActionStatus" NOT NULL DEFAULT 'OPEN',
  "completion_session_id" UUID,
  "meaning" "CapaSignatureMeaning",
  "authentication_method" "CapaAuthenticationMethod",
  "completion_comment" VARCHAR(2000),
  "completed_at" TIMESTAMPTZ(3),
  "record_hash" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_actions_definition_check" CHECK (
    char_length(btrim("title")) BETWEEN 5 AND 200
    AND char_length(btrim("description")) BETWEEN 10 AND 2000
    AND "due_at" > "created_at"
  ),
  CONSTRAINT "capa_actions_state_check" CHECK (
    (
      "status" = 'OPEN'
      AND "completion_session_id" IS NULL
      AND "meaning" IS NULL
      AND "authentication_method" IS NULL
      AND "completion_comment" IS NULL
      AND "completed_at" IS NULL
      AND "record_hash" IS NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "completion_session_id" IS NOT NULL
      AND "meaning" = 'ACTION_COMPLETION'
      AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
      AND char_length(btrim("completion_comment")) BETWEEN 10 AND 2000
      AND "completed_at" IS NOT NULL
      AND "record_hash" ~ '^[0-9a-f]{64}$'
    )
  )
);

CREATE UNIQUE INDEX "capas_tenant_id_id_key"
  ON "capas"("tenant_id", "id");
CREATE UNIQUE INDEX "capas_tenant_id_code_key"
  ON "capas"("tenant_id", "code");
CREATE UNIQUE INDEX "capas_tenant_deviation_key"
  ON "capas"("tenant_id", "deviation_id");
CREATE UNIQUE INDEX "capas_tenant_investigation_key"
  ON "capas"("tenant_id", "investigation_id");
CREATE INDEX "capas_tenant_created_idx"
  ON "capas"("tenant_id", "created_at");

CREATE UNIQUE INDEX "capa_actions_tenant_id_id_key"
  ON "capa_actions"("tenant_id", "id");
CREATE INDEX "capa_actions_capa_status_due_idx"
  ON "capa_actions"("tenant_id", "capa_id", "status", "due_at");
CREATE INDEX "capa_actions_assignee_status_due_idx"
  ON "capa_actions"("tenant_id", "assigned_to_user_id", "status", "due_at");
CREATE INDEX "capa_actions_status_due_idx"
  ON "capa_actions"("tenant_id", "status", "due_at");

ALTER TABLE "capa_sequences"
  ADD CONSTRAINT "capa_sequences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capas"
  ADD CONSTRAINT "capas_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capas"
  ADD CONSTRAINT "capas_tenant_deviation_fkey"
  FOREIGN KEY ("tenant_id", "deviation_id") REFERENCES "deviations"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capas"
  ADD CONSTRAINT "capas_tenant_investigation_fkey"
  FOREIGN KEY ("tenant_id", "investigation_id") REFERENCES "deviation_investigations"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capas"
  ADD CONSTRAINT "capas_tenant_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_actions"
  ADD CONSTRAINT "capa_actions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_actions"
  ADD CONSTRAINT "capa_actions_tenant_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_actions"
  ADD CONSTRAINT "capa_actions_tenant_assignee_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_actions"
  ADD CONSTRAINT "capa_actions_completion_session_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id", "completion_session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Human-readable CAPA numbers advance exactly once per tenant and year.
CREATE FUNCTION public.guard_capa_sequence_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.year IS DISTINCT FROM NEW.year
    OR NEW.last_number <> OLD.last_number + 1
  THEN
    RAISE EXCEPTION 'CAPA sequence identity is immutable and must advance by one.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_sequences_update_guard
BEFORE UPDATE ON "capa_sequences"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_sequence_update();

CREATE FUNCTION public.guard_capa_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.deviations deviation
    JOIN public.deviation_investigations investigation
      ON investigation.tenant_id = deviation.tenant_id
      AND investigation.deviation_id = deviation.id
    WHERE deviation.tenant_id = NEW.tenant_id
      AND deviation.id = NEW.deviation_id
      AND deviation.status = 'INVESTIGATION_COMPLETED'
      AND investigation.id = NEW.investigation_id
      AND investigation.requires_capa = true
  ) THEN
    RAISE EXCEPTION 'CAPA source must be a completed investigation requiring CAPA.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capas_insert_guard
BEFORE INSERT ON "capas"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_insert();

CREATE FUNCTION public.prevent_capa_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'CAPA plans are immutable after creation.'
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION public.prevent_capa_mutation() FROM PUBLIC;

CREATE TRIGGER capas_prevent_update_delete
BEFORE UPDATE OR DELETE ON "capas"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_capa_mutation();

-- Actions are defined atomically with the plan and cannot be appended later.
CREATE FUNCTION public.guard_capa_action_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.capas capa
    WHERE capa.tenant_id = NEW.tenant_id
      AND capa.id = NEW.capa_id
      AND capa.created_at = CURRENT_TIMESTAMP(3)
  ) THEN
    RAISE EXCEPTION 'CAPA actions may only be defined with the original plan.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_actions_insert_guard
BEFORE INSERT ON "capa_actions"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_action_insert();

CREATE FUNCTION public.guard_capa_action_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'A CAPA action may only transition once from open to completed.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.type IS DISTINCT FROM NEW.type
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'CAPA action plan evidence is immutable.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_actions_transition_guard
BEFORE UPDATE ON "capa_actions"
FOR EACH ROW
EXECUTE FUNCTION public.guard_capa_action_transition();

CREATE TRIGGER capa_actions_prevent_delete
BEFORE DELETE ON "capa_actions"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_capa_mutation();

CREATE FUNCTION public.assert_capa_has_actions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id
      AND action.capa_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A CAPA plan must contain at least one action.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER capas_require_actions
AFTER INSERT ON "capas"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_capa_has_actions();

ALTER TABLE "capa_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_sequences"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE "capas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capas" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capas"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE "capa_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_actions"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "capa_sequences" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "capas" TO qualyra_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "capa_actions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "capa_sequences", "capas", "capa_actions" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "capas" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'capas.read', 'View CAPA plans and action evidence.'),
  (gen_random_uuid(), 'capas.create', 'Create CAPA plans from completed investigations.'),
  (gen_random_uuid(), 'capas.execute', 'Complete assigned CAPA actions.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

-- Extend standard roles without replacing tenant-specific grants.
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
        ('Administrator', 'capas.read'),
        ('Administrator', 'capas.create'),
        ('Administrator', 'capas.execute'),
        ('QA Manager', 'capas.read'),
        ('QA Manager', 'capas.create'),
        ('QA Manager', 'capas.execute'),
        ('Document Controller', 'capas.read'),
        ('Document Controller', 'capas.execute'),
        ('Operator', 'capas.read'),
        ('Operator', 'capas.execute'),
        ('Auditor', 'capas.read')
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
