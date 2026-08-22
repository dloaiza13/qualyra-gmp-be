CREATE TYPE "HelpGuideContext" AS ENUM (
  'OVERVIEW',
  'ORGANIZATION',
  'DOCUMENTS',
  'TRAINING',
  'DEVIATIONS',
  'CAPAS',
  'CHANGES',
  'AUDITS',
  'RISKS',
  'SUPPLIERS',
  'EQUIPMENT',
  'COMPLAINTS',
  'RECALLS',
  'PRODUCT_REVIEWS',
  'USERS',
  'ROLES',
  'INVITATIONS',
  'SECURITY',
  'NOTIFICATIONS',
  'PROFILE',
  'SECURITY_SETTINGS'
);

CREATE TYPE "HelpGuideRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE "help_guides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "context" "HelpGuideContext" NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "help_guides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "help_guides_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "help_guides_sort_order_check" CHECK ("sort_order" BETWEEN 0 AND 10000)
);

CREATE TABLE "help_guide_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "guide_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "HelpGuideRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "title_es" VARCHAR(160) NOT NULL,
  "title_en" VARCHAR(160) NOT NULL,
  "summary_es" VARCHAR(600) NOT NULL,
  "summary_en" VARCHAR(600) NOT NULL,
  "steps_es" JSONB NOT NULL,
  "steps_en" JSONB NOT NULL,
  "media_url" VARCHAR(2048),
  "video_url" VARCHAR(2048),
  "resource_label_es" VARCHAR(160),
  "resource_label_en" VARCHAR(160),
  "resource_url" VARCHAR(2048),
  "created_by_user_id" UUID NOT NULL,
  "published_by_user_id" UUID,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "help_guide_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "help_guide_revisions_version_check" CHECK ("version" > 0),
  CONSTRAINT "help_guide_revisions_steps_es_check" CHECK (
    jsonb_typeof("steps_es") = 'array' AND jsonb_array_length("steps_es") BETWEEN 1 AND 30
  ),
  CONSTRAINT "help_guide_revisions_steps_en_check" CHECK (
    jsonb_typeof("steps_en") = 'array' AND jsonb_array_length("steps_en") BETWEEN 1 AND 30
  ),
  CONSTRAINT "help_guide_revisions_publication_check" CHECK (
    ("status" = 'DRAFT' AND "published_by_user_id" IS NULL AND "published_at" IS NULL)
    OR
    ("status" IN ('PUBLISHED', 'RETIRED') AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL)
  ),
  CONSTRAINT "help_guide_revisions_resource_check" CHECK (
    ("resource_url" IS NULL AND "resource_label_es" IS NULL AND "resource_label_en" IS NULL)
    OR
    ("resource_url" IS NOT NULL AND "resource_label_es" IS NOT NULL AND "resource_label_en" IS NOT NULL)
  )
);

CREATE TABLE "help_guide_feedback" (
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "guide_key" VARCHAR(140) NOT NULL,
  "helpful" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "help_guide_feedback_pkey" PRIMARY KEY ("tenant_id", "user_id", "guide_key"),
  CONSTRAINT "help_guide_feedback_key_check" CHECK (
    "guide_key" ~ '^(system:[a-z0-9-]+|tenant:[0-9a-f-]{36})$'
  )
);

CREATE UNIQUE INDEX "help_guides_tenant_id_id_key"
  ON "help_guides"("tenant_id", "id");
CREATE UNIQUE INDEX "help_guides_tenant_slug_key"
  ON "help_guides"("tenant_id", "slug");
CREATE INDEX "help_guides_context_idx"
  ON "help_guides"("tenant_id", "context", "archived_at", "sort_order");

CREATE UNIQUE INDEX "help_guide_revisions_tenant_id_id_key"
  ON "help_guide_revisions"("tenant_id", "id");
CREATE UNIQUE INDEX "help_guide_revisions_version_key"
  ON "help_guide_revisions"("tenant_id", "guide_id", "version");
CREATE INDEX "help_guide_revisions_status_idx"
  ON "help_guide_revisions"("tenant_id", "guide_id", "status");
CREATE UNIQUE INDEX "help_guide_revisions_one_draft_idx"
  ON "help_guide_revisions"("tenant_id", "guide_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "help_guide_revisions_one_published_idx"
  ON "help_guide_revisions"("tenant_id", "guide_id") WHERE "status" = 'PUBLISHED';

CREATE INDEX "help_guide_feedback_summary_idx"
  ON "help_guide_feedback"("tenant_id", "guide_key", "helpful");

ALTER TABLE "help_guides"
  ADD CONSTRAINT "help_guides_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "help_guides"
  ADD CONSTRAINT "help_guides_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "help_guide_revisions"
  ADD CONSTRAINT "help_guide_revisions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "help_guide_revisions"
  ADD CONSTRAINT "help_guide_revisions_guide_fkey"
  FOREIGN KEY ("tenant_id", "guide_id") REFERENCES "help_guides"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "help_guide_revisions"
  ADD CONSTRAINT "help_guide_revisions_creator_fkey"
  FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "help_guide_revisions"
  ADD CONSTRAINT "help_guide_revisions_publisher_fkey"
  FOREIGN KEY ("tenant_id", "published_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "help_guide_feedback"
  ADD CONSTRAINT "help_guide_feedback_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "help_guide_feedback"
  ADD CONSTRAINT "help_guide_feedback_user_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.guard_help_guide_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND ROW(
    NEW.tenant_id, NEW.guide_id, NEW.version, NEW.title_es, NEW.title_en,
    NEW.summary_es, NEW.summary_en, NEW.steps_es, NEW.steps_en, NEW.media_url,
    NEW.video_url, NEW.resource_label_es, NEW.resource_label_en, NEW.resource_url,
    NEW.created_by_user_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.tenant_id, OLD.guide_id, OLD.version, OLD.title_es, OLD.title_en,
    OLD.summary_es, OLD.summary_en, OLD.steps_es, OLD.steps_en, OLD.media_url,
    OLD.video_url, OLD.resource_label_es, OLD.resource_label_en, OLD.resource_url,
    OLD.created_by_user_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Published help guide content is immutable.' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
    RAISE EXCEPTION 'Invalid help guide draft transition.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'Published help guides can only be retired.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'Retired help guide revisions are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER help_guide_revisions_guard
BEFORE UPDATE ON "help_guide_revisions"
FOR EACH ROW EXECUTE FUNCTION public.guard_help_guide_revision_mutation();

REVOKE ALL ON FUNCTION public.guard_help_guide_revision_mutation() FROM PUBLIC;

ALTER TABLE "help_guides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "help_guides" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "help_guides"
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.current_tenant_id());

ALTER TABLE "help_guide_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "help_guide_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "help_guide_revisions"
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.current_tenant_id());

ALTER TABLE "help_guide_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "help_guide_feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "help_guide_feedback"
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "help_guides" TO qualyra_runtime;
REVOKE DELETE ON TABLE "help_guides" FROM qualyra_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "help_guide_revisions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "help_guide_revisions" FROM qualyra_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "help_guide_feedback" TO qualyra_runtime;
REVOKE DELETE ON TABLE "help_guide_feedback" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'help_guides.read', 'View contextual system and organization help guides.'),
  (gen_random_uuid(), 'help_guides.manage', 'Create and edit organization help guide drafts.'),
  (gen_random_uuid(), 'help_guides.publish', 'Publish and retire organization help guides.')
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
        (permission.code = 'help_guides.read' AND role.name IN (
          'Administrator', 'QA Manager', 'Document Controller', 'Operator', 'Auditor'
        ))
        OR
        (permission.code IN ('help_guides.manage', 'help_guides.publish')
          AND role.name IN ('Administrator', 'Document Controller'))
      )
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
