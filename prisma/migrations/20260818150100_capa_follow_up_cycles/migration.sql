-- Phase 18 preserves each ineffective review and adds an immutable, numbered
-- follow-up cycle instead of reopening historical CAPA evidence.
ALTER TABLE "capa_effectiveness_reviews"
  ADD COLUMN "cycle_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "capa_effectiveness_reviews"
  ADD CONSTRAINT "capa_effectiveness_reviews_cycle_check"
  CHECK ("cycle_number" >= 0);
DROP INDEX "capa_effectiveness_reviews_tenant_capa_key";
CREATE UNIQUE INDEX "capa_effectiveness_reviews_tenant_capa_cycle_key"
  ON "capa_effectiveness_reviews"("tenant_id", "capa_id", "cycle_number");

CREATE TABLE "capa_follow_up_cycles" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "source_effectiveness_review_id" UUID NOT NULL,
  "cycle_number" INTEGER NOT NULL,
  "rationale" VARCHAR(2000) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(3),

  CONSTRAINT "capa_follow_up_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_follow_up_cycles_definition_check" CHECK (
    "cycle_number" > 0
    AND char_length(btrim("rationale")) BETWEEN 10 AND 2000
    AND ("locked_at" IS NULL OR "locked_at" >= "created_at")
  )
);

CREATE UNIQUE INDEX "capa_follow_up_cycles_tenant_id_id_key"
  ON "capa_follow_up_cycles"("tenant_id", "id");
CREATE UNIQUE INDEX "capa_follow_up_cycles_source_review_key"
  ON "capa_follow_up_cycles"("tenant_id", "source_effectiveness_review_id");
CREATE UNIQUE INDEX "capa_follow_up_cycles_capa_cycle_key"
  ON "capa_follow_up_cycles"("tenant_id", "capa_id", "cycle_number");
CREATE INDEX "capa_follow_up_cycles_capa_created_idx"
  ON "capa_follow_up_cycles"("tenant_id", "capa_id", "created_at");

ALTER TABLE "capa_actions" ADD COLUMN "follow_up_cycle_id" UUID;

CREATE TABLE "capa_action_extensions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "action_id" UUID NOT NULL,
  "previous_due_at" TIMESTAMPTZ(3) NOT NULL,
  "new_due_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "approved_by_user_id" UUID NOT NULL,
  "approval_session_id" UUID NOT NULL,
  "meaning" "CapaSignatureMeaning" NOT NULL DEFAULT 'ACTION_EXTENSION_APPROVAL',
  "authentication_method" "CapaAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
  "approved_at" TIMESTAMPTZ(3) NOT NULL,
  "record_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_action_extensions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_action_extensions_evidence_check" CHECK (
    "new_due_at" > "previous_due_at"
    AND "new_due_at" > "approved_at"
    AND char_length(btrim("reason")) BETWEEN 10 AND 2000
    AND "meaning" = 'ACTION_EXTENSION_APPROVAL'
    AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
    AND "record_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "capa_action_extensions_tenant_id_id_key"
  ON "capa_action_extensions"("tenant_id", "id");
CREATE INDEX "capa_action_extensions_action_approved_idx"
  ON "capa_action_extensions"("tenant_id", "action_id", "approved_at");

CREATE TABLE "capa_action_evidence_references" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "capa_id" UUID NOT NULL,
  "action_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(150) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "storage_reference" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capa_action_evidence_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capa_action_evidence_metadata_check" CHECK (
    char_length(btrim("file_name")) BETWEEN 1 AND 255
    AND char_length(btrim("content_type")) BETWEEN 3 AND 150
    AND "size_bytes" BETWEEN 1 AND 1073741824
    AND "sha256" ~ '^[0-9a-f]{64}$'
    AND char_length(btrim("storage_reference")) BETWEEN 3 AND 1000
  )
);

CREATE UNIQUE INDEX "capa_action_evidence_tenant_id_id_key"
  ON "capa_action_evidence_references"("tenant_id", "id");
CREATE UNIQUE INDEX "capa_action_evidence_action_reference_key"
  ON "capa_action_evidence_references"("tenant_id", "action_id", "storage_reference");
CREATE INDEX "capa_action_evidence_action_created_idx"
  ON "capa_action_evidence_references"("tenant_id", "action_id", "created_at");

ALTER TABLE "capa_follow_up_cycles"
  ADD CONSTRAINT "capa_follow_up_cycles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_follow_up_cycles"
  ADD CONSTRAINT "capa_follow_up_cycles_tenant_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_follow_up_cycles"
  ADD CONSTRAINT "capa_follow_up_cycles_source_review_fkey"
  FOREIGN KEY ("tenant_id", "source_effectiveness_review_id") REFERENCES "capa_effectiveness_reviews"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_follow_up_cycles"
  ADD CONSTRAINT "capa_follow_up_cycles_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_actions"
  ADD CONSTRAINT "capa_actions_follow_up_cycle_fkey"
  FOREIGN KEY ("tenant_id", "follow_up_cycle_id") REFERENCES "capa_follow_up_cycles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_extensions"
  ADD CONSTRAINT "capa_action_extensions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_extensions"
  ADD CONSTRAINT "capa_action_extensions_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_extensions"
  ADD CONSTRAINT "capa_action_extensions_action_fkey"
  FOREIGN KEY ("tenant_id", "action_id") REFERENCES "capa_actions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_extensions"
  ADD CONSTRAINT "capa_action_extensions_approver_fkey"
  FOREIGN KEY ("tenant_id", "approved_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_extensions"
  ADD CONSTRAINT "capa_action_extensions_session_fkey"
  FOREIGN KEY ("tenant_id", "approved_by_user_id", "approval_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_evidence_references"
  ADD CONSTRAINT "capa_action_evidence_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_evidence_references"
  ADD CONSTRAINT "capa_action_evidence_capa_fkey"
  FOREIGN KEY ("tenant_id", "capa_id") REFERENCES "capas"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capa_action_evidence_references"
  ADD CONSTRAINT "capa_action_evidence_action_fkey"
  FOREIGN KEY ("tenant_id", "action_id") REFERENCES "capa_actions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_capa_follow_up_cycle_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.capa_effectiveness_reviews review
    WHERE review.tenant_id = NEW.tenant_id
      AND review.id = NEW.source_effectiveness_review_id
      AND review.capa_id = NEW.capa_id
      AND review.status = 'COMPLETED'
      AND review.decision = 'INEFFECTIVE'
      AND NEW.cycle_number = review.cycle_number + 1
      AND review.cycle_number = (
        SELECT max(latest.cycle_number)
        FROM public.capa_effectiveness_reviews latest
        WHERE latest.tenant_id = NEW.tenant_id AND latest.capa_id = NEW.capa_id
      )
  ) THEN
    RAISE EXCEPTION 'A follow-up cycle requires the latest ineffective effectiveness review.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_follow_up_cycles_insert_guard
BEFORE INSERT ON "capa_follow_up_cycles"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_follow_up_cycle_insert();

CREATE FUNCTION public.guard_capa_follow_up_cycle_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.locked_at IS NOT NULL OR NEW.locked_at IS NULL
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.source_effectiveness_review_id IS DISTINCT FROM NEW.source_effectiveness_review_id
    OR OLD.cycle_number IS DISTINCT FROM NEW.cycle_number
    OR OLD.rationale IS DISTINCT FROM NEW.rationale
    OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT EXISTS (
      SELECT 1 FROM public.capa_actions action
      WHERE action.tenant_id = NEW.tenant_id AND action.follow_up_cycle_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'CAPA follow-up cycles are immutable after being locked.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_follow_up_cycles_mutation_guard
BEFORE UPDATE OR DELETE ON "capa_follow_up_cycles"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_follow_up_cycle_mutation();

CREATE OR REPLACE FUNCTION public.guard_capa_action_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.follow_up_cycle_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.capas capa
      WHERE capa.tenant_id = NEW.tenant_id AND capa.id = NEW.capa_id AND capa.locked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Original CAPA actions may only be defined before the plan is locked.' USING ERRCODE = '55000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.capa_follow_up_cycles cycle
    WHERE cycle.tenant_id = NEW.tenant_id
      AND cycle.id = NEW.follow_up_cycle_id
      AND cycle.capa_id = NEW.capa_id
      AND cycle.locked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Follow-up actions may only be defined before their cycle is locked.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_capa_action_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'A CAPA action may only transition once from open to completed.' USING ERRCODE = '55000';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.follow_up_cycle_id IS DISTINCT FROM NEW.follow_up_cycle_id
    OR OLD.type IS DISTINCT FROM NEW.type
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'CAPA action plan evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_capa_effectiveness_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cycle_number = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.capa_actions action
      WHERE action.tenant_id = NEW.tenant_id AND action.capa_id = NEW.capa_id
        AND (action.follow_up_cycle_id IS NOT NULL OR action.status <> 'COMPLETED')
    ) THEN
      RAISE EXCEPTION 'Initial effectiveness review requires all original actions completed.' USING ERRCODE = '55000';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.capa_follow_up_cycles cycle
    WHERE cycle.tenant_id = NEW.tenant_id AND cycle.capa_id = NEW.capa_id
      AND cycle.cycle_number = NEW.cycle_number AND cycle.locked_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.capa_actions action
    JOIN public.capa_follow_up_cycles cycle
      ON cycle.tenant_id = action.tenant_id AND cycle.id = action.follow_up_cycle_id
    WHERE action.tenant_id = NEW.tenant_id AND action.capa_id = NEW.capa_id
      AND cycle.cycle_number = NEW.cycle_number AND action.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Follow-up effectiveness review requires all current-cycle actions completed.' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id AND action.capa_id = NEW.capa_id
      AND action.assigned_to_user_id = NEW.assigned_to_user_id
  ) THEN
    RAISE EXCEPTION 'Effectiveness reviewer must be independent from all CAPA action execution.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_capa_effectiveness_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'SCHEDULED' OR NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'An effectiveness review may only transition once from scheduled to completed.' USING ERRCODE = '55000';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.capa_id IS DISTINCT FROM NEW.capa_id
    OR OLD.cycle_number IS DISTINCT FROM NEW.cycle_number
    OR OLD.criterion IS DISTINCT FROM NEW.criterion
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.scheduled_by_user_id IS DISTINCT FROM NEW.scheduled_by_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Effectiveness review schedule evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_capa_action_extension_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_due TIMESTAMPTZ(3);
BEGIN
  SELECT COALESCE(
    (SELECT extension.new_due_at FROM public.capa_action_extensions extension
     WHERE extension.tenant_id = NEW.tenant_id AND extension.action_id = NEW.action_id
     ORDER BY extension.approved_at DESC, extension.id DESC LIMIT 1),
    action.due_at
  ) INTO current_due
  FROM public.capa_actions action
  WHERE action.tenant_id = NEW.tenant_id AND action.id = NEW.action_id
    AND action.capa_id = NEW.capa_id AND action.status = 'OPEN'
    AND action.assigned_to_user_id <> NEW.approved_by_user_id;

  IF current_due IS NULL OR NEW.previous_due_at IS DISTINCT FROM current_due OR NEW.new_due_at <= current_due THEN
    RAISE EXCEPTION 'Extension requires an open action, independent approver, and a later due date.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_action_extensions_insert_guard
BEFORE INSERT ON "capa_action_extensions"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_action_extension_insert();

CREATE FUNCTION public.guard_capa_action_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.capa_actions action
    WHERE action.tenant_id = NEW.tenant_id AND action.id = NEW.action_id
      AND action.capa_id = NEW.capa_id AND action.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Evidence references may only be attached during open-action completion.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capa_action_evidence_insert_guard
BEFORE INSERT ON "capa_action_evidence_references"
FOR EACH ROW EXECUTE FUNCTION public.guard_capa_action_evidence_insert();

CREATE FUNCTION public.prevent_capa_follow_up_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'CAPA extension and evidence reference records are immutable.' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_capa_follow_up_evidence_mutation() FROM PUBLIC;

CREATE TRIGGER capa_action_extensions_prevent_mutation
BEFORE UPDATE OR DELETE ON "capa_action_extensions"
FOR EACH ROW EXECUTE FUNCTION public.prevent_capa_follow_up_evidence_mutation();
CREATE TRIGGER capa_action_evidence_prevent_mutation
BEFORE UPDATE OR DELETE ON "capa_action_evidence_references"
FOR EACH ROW EXECUTE FUNCTION public.prevent_capa_follow_up_evidence_mutation();

ALTER TABLE "capa_follow_up_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_follow_up_cycles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_follow_up_cycles"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
ALTER TABLE "capa_action_extensions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_action_extensions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_action_extensions"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
ALTER TABLE "capa_action_evidence_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa_action_evidence_references" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa_action_evidence_references"
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "capa_follow_up_cycles" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "capa_action_extensions", "capa_action_evidence_references" TO qualyra_runtime;
REVOKE DELETE ON TABLE "capa_follow_up_cycles", "capa_action_extensions", "capa_action_evidence_references" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "capa_action_extensions", "capa_action_evidence_references" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'capas.create_follow_up', 'Create controlled actions after an ineffective CAPA review.'),
  (gen_random_uuid(), 'capas.approve_extensions', 'Approve authenticated CAPA action due-date extensions.')
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
      ('Administrator', 'capas.create_follow_up'),
      ('Administrator', 'capas.approve_extensions'),
      ('QA Manager', 'capas.create_follow_up'),
      ('QA Manager', 'capas.approve_extensions')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
