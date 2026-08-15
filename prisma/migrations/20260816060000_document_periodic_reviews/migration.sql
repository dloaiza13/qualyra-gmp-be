-- CreateEnum
CREATE TYPE "DocumentPeriodicReviewStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "DocumentPeriodicReviewDecision" AS ENUM (
  'CONFIRM_EFFECTIVE',
  'REVISION_REQUIRED'
);

-- Add the active periodic-review policy to each controlled document.
ALTER TABLE "documents"
  ADD COLUMN "periodic_review_interval_months" INTEGER,
  ADD COLUMN "periodic_review_reviewer_user_id" UUID,
  ADD CONSTRAINT "documents_periodic_review_configuration_check"
    CHECK (
      (
        "periodic_review_interval_months" IS NULL
        AND "periodic_review_reviewer_user_id" IS NULL
      )
      OR (
        "periodic_review_interval_months" BETWEEN 1 AND 60
        AND "periodic_review_reviewer_user_id" IS NOT NULL
      )
    );

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_tenant_id_periodic_review_reviewer_user_id_fkey"
  FOREIGN KEY ("tenant_id", "periodic_review_reviewer_user_id")
  REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "document_periodic_reviews" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_version_id" UUID NOT NULL,
  "assigned_to_user_id" UUID NOT NULL,
  "scheduled_by_user_id" UUID NOT NULL,
  "interval_months" INTEGER NOT NULL,
  "status" "DocumentPeriodicReviewStatus" NOT NULL DEFAULT 'PENDING',
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "decision" "DocumentPeriodicReviewDecision",
  "comment" VARCHAR(2000),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "document_periodic_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_periodic_reviews_interval_check"
    CHECK ("interval_months" BETWEEN 1 AND 60),
  CONSTRAINT "document_periodic_reviews_state_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "decision" IS NULL
        AND "comment" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'COMPLETED'
        AND "decision" IS NOT NULL
        AND char_length(btrim("comment")) BETWEEN 3 AND 2000
        AND "completed_at" IS NOT NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
      OR (
        "status" = 'CANCELLED'
        AND "decision" IS NULL
        AND "comment" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NOT NULL
        AND char_length(btrim("cancellation_reason")) BETWEEN 3 AND 100
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "document_periodic_reviews_tenant_id_id_key"
  ON "document_periodic_reviews"("tenant_id", "id");
CREATE UNIQUE INDEX "document_periodic_reviews_one_pending_per_document_key"
  ON "document_periodic_reviews"("tenant_id", "document_id")
  WHERE "status" = 'PENDING';
CREATE INDEX "document_periodic_reviews_tenant_document_created_idx"
  ON "document_periodic_reviews"("tenant_id", "document_id", "created_at");
CREATE INDEX "document_periodic_reviews_assignee_status_due_idx"
  ON "document_periodic_reviews"("tenant_id", "assigned_to_user_id", "status", "due_at");
CREATE INDEX "document_periodic_reviews_status_due_idx"
  ON "document_periodic_reviews"("tenant_id", "status", "due_at");

-- AddForeignKey
ALTER TABLE "document_periodic_reviews"
  ADD CONSTRAINT "document_periodic_reviews_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_periodic_reviews"
  ADD CONSTRAINT "document_periodic_reviews_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_periodic_reviews"
  ADD CONSTRAINT "document_periodic_reviews_tenant_id_document_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "document_versions"("tenant_id", "document_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_periodic_reviews"
  ADD CONSTRAINT "document_periodic_reviews_tenant_id_assigned_to_user_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_to_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_periodic_reviews"
  ADD CONSTRAINT "document_periodic_reviews_tenant_id_scheduled_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "scheduled_by_user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A pending cycle can transition once; completed or cancelled evidence is immutable.
CREATE FUNCTION public.guard_document_periodic_review_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Finalized periodic review records are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.document_id IS DISTINCT FROM NEW.document_id
    OR OLD.document_version_id IS DISTINCT FROM NEW.document_version_id
    OR OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id
    OR OLD.scheduled_by_user_id IS DISTINCT FROM NEW.scheduled_by_user_id
    OR OLD.interval_months IS DISTINCT FROM NEW.interval_months
    OR OLD.due_at IS DISTINCT FROM NEW.due_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Periodic review identity and schedule are immutable.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'Periodic review updates must finalize the pending cycle.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER document_periodic_reviews_transition_guard
BEFORE UPDATE ON "document_periodic_reviews"
FOR EACH ROW
EXECUTE FUNCTION public.guard_document_periodic_review_transition();

-- Tenant isolation and least-privilege runtime access.
ALTER TABLE "document_periodic_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_periodic_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_periodic_reviews"
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "document_periodic_reviews" TO qualyra_runtime;
REVOKE DELETE ON TABLE "document_periodic_reviews" FROM qualyra_runtime;
