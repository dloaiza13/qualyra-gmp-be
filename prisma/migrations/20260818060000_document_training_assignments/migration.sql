-- CreateEnum
CREATE TYPE "TrainingAssignmentStatus" AS ENUM (
  'ASSIGNED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "TrainingSignatureMeaning" AS ENUM (
  'TRAINING_ACKNOWLEDGEMENT'
);

CREATE TYPE "TrainingAuthenticationMethod" AS ENUM (
  'PASSWORD_REAUTHENTICATION'
);

-- CreateTable
CREATE TABLE "training_assignments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "assigned_to_user_id" UUID NOT NULL,
  "assigned_by_user_id" UUID NOT NULL,
  "status" "TrainingAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "meaning" "TrainingSignatureMeaning",
  "authentication_method" "TrainingAuthenticationMethod",
  "completion_session_id" UUID,
  "completion_comment" VARCHAR(2000),
  "completed_at" TIMESTAMPTZ(3),
  "record_hash" CHAR(64),
  "cancelled_by_user_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "training_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_assignments_reason_check"
    CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "training_assignments_state_check"
    CHECK (
      (
        "status" = 'ASSIGNED'
        AND "meaning" IS NULL
        AND "authentication_method" IS NULL
        AND "completion_session_id" IS NULL
        AND "completion_comment" IS NULL
        AND "completed_at" IS NULL
        AND "record_hash" IS NULL
        AND "cancelled_by_user_id" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'COMPLETED'
        AND "meaning" = 'TRAINING_ACKNOWLEDGEMENT'
        AND "authentication_method" = 'PASSWORD_REAUTHENTICATION'
        AND "completion_session_id" IS NOT NULL
        AND char_length(btrim("completion_comment")) BETWEEN 3 AND 2000
        AND "completed_at" IS NOT NULL
        AND "record_hash" ~ '^[0-9a-f]{64}$'
        AND "cancelled_by_user_id" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'CANCELLED'
        AND "meaning" IS NULL
        AND "authentication_method" IS NULL
        AND "completion_session_id" IS NULL
        AND "completion_comment" IS NULL
        AND "completed_at" IS NULL
        AND "record_hash" IS NULL
        AND "cancelled_by_user_id" IS NOT NULL
        AND "cancelled_at" IS NOT NULL
        AND char_length(btrim("cancellation_reason")) BETWEEN 3 AND 500
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "training_assignments_tenant_id_id_key"
  ON "training_assignments"("tenant_id", "id");
CREATE UNIQUE INDEX "training_assignments_one_open_per_user_version_key"
  ON "training_assignments"("tenant_id", "document_version_id", "assigned_to_user_id")
  WHERE "status" = 'ASSIGNED';
CREATE INDEX "training_assignments_assignee_status_due_idx"
  ON "training_assignments"("tenant_id", "assigned_to_user_id", "status", "due_at");
CREATE INDEX "training_assignments_document_version_idx"
  ON "training_assignments"("tenant_id", "document_id", "document_version_id");
CREATE INDEX "training_assignments_status_due_idx"
  ON "training_assignments"("tenant_id", "status", "due_at");

-- AddForeignKey
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_document_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "document_versions"("tenant_id", "document_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_assigned_to_user_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_assigned_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_cancelled_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "cancelled_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_assignments"
  ADD CONSTRAINT "training_assignments_tenant_id_assigned_to_user_id_completion_session_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id", "completion_session_id")
  REFERENCES "sessions"("tenant_id", "user_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- An open assignment can transition once; completed or cancelled evidence is immutable.
CREATE FUNCTION public.guard_training_assignment_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'ASSIGNED' THEN
    RAISE EXCEPTION 'Finalized training assignment records are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.document_id IS DISTINCT FROM NEW.document_id
    OR OLD.document_version_id IS DISTINCT FROM NEW.document_version_id
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.assigned_by_user_id IS DISTINCT FROM NEW.assigned_by_user_id
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.reason IS DISTINCT FROM NEW.reason
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Training assignment identity and schedule are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'ASSIGNED' THEN
    RAISE EXCEPTION 'Training assignment updates must finalize the open assignment.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER training_assignments_transition_guard
BEFORE UPDATE ON "training_assignments"
FOR EACH ROW
EXECUTE FUNCTION public.guard_training_assignment_transition();

-- Tenant isolation and least-privilege runtime access.
ALTER TABLE "training_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "training_assignments"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "training_assignments" TO qualyra_runtime;
REVOKE DELETE ON TABLE "training_assignments" FROM qualyra_runtime;
