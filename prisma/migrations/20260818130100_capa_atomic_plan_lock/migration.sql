-- Replace timestamp-comparison locking with an explicit atomic plan lock.
ALTER TABLE "capas" ADD COLUMN "locked_at" TIMESTAMPTZ(3);
ALTER TABLE "capas"
  ADD CONSTRAINT "capas_lock_check"
  CHECK ("locked_at" IS NULL OR "locked_at" >= "created_at");

CREATE OR REPLACE FUNCTION public.guard_capa_action_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.capas capa
    WHERE capa.tenant_id = NEW.tenant_id
      AND capa.id = NEW.capa_id
      AND capa.locked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CAPA actions may only be defined before the plan is locked.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_capa_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAPA plans are immutable after creation.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.locked_at IS NOT NULL
    OR NEW.locked_at IS NULL
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.deviation_id IS DISTINCT FROM NEW.deviation_id
    OR OLD.investigation_id IS DISTINCT FROM NEW.investigation_id
    OR OLD.code IS DISTINCT FROM NEW.code
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.objective IS DISTINCT FROM NEW.objective
    OR OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT EXISTS (
      SELECT 1
      FROM public.capa_actions action
      WHERE action.tenant_id = NEW.tenant_id
        AND action.capa_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'CAPA plans are immutable after creation.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE ON TABLE "capas" TO qualyra_runtime;
