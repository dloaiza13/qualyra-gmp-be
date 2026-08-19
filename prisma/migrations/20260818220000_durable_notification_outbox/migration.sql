-- Phase 22 turns the existing tenant-scoped outbox into a durable notification
-- queue with explicit leases, exponential retries, dead-letter recovery, and
-- idempotent enqueue keys. Payloads are encrypted by the application.
ALTER TYPE "OutboxStatus" RENAME TO "OutboxStatus_old";
CREATE TYPE "OutboxStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'
);
ALTER TABLE "outbox_messages"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "OutboxStatus"
    USING ("status"::text::"OutboxStatus"),
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "OutboxStatus_old";

DROP INDEX IF EXISTS "outbox_messages_status_available_at_idx";

ALTER TABLE "outbox_messages"
  ADD COLUMN "deduplication_key" VARCHAR(300),
  ADD COLUMN "manual_retries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "locked_by" UUID,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(3),
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "outbox_messages"
SET "deduplication_key" = 'legacy:' || "id"::text
WHERE "deduplication_key" IS NULL;

ALTER TABLE "outbox_messages"
  ALTER COLUMN "deduplication_key" SET NOT NULL,
  ALTER COLUMN "last_error" TYPE VARCHAR(100),
  DROP CONSTRAINT "outbox_messages_attempts_check",
  ADD CONSTRAINT "outbox_messages_attempts_check"
    CHECK ("attempts" >= 0 AND "manual_retries" >= 0),
  ADD CONSTRAINT "outbox_messages_lease_check"
    CHECK (
      ("status" = 'PROCESSING' AND "locked_at" IS NOT NULL AND "locked_by" IS NOT NULL)
      OR ("status" <> 'PROCESSING' AND "locked_at" IS NULL AND "locked_by" IS NULL)
    ),
  ADD CONSTRAINT "outbox_messages_completion_check"
    CHECK (
      ("status" = 'PROCESSED' AND "processed_at" IS NOT NULL AND "dead_lettered_at" IS NULL)
      OR ("status" = 'DEAD_LETTER' AND "processed_at" IS NULL AND "dead_lettered_at" IS NOT NULL)
      OR ("status" NOT IN ('PROCESSED', 'DEAD_LETTER') AND "processed_at" IS NULL AND "dead_lettered_at" IS NULL)
    );

CREATE UNIQUE INDEX "outbox_messages_tenant_dedup_key"
  ON "outbox_messages"("tenant_id", "deduplication_key");
CREATE INDEX "outbox_messages_claim_idx"
  ON "outbox_messages"("tenant_id", "status", "available_at");

INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid(), 'notifications.read', 'View notification delivery status.'),
  (gen_random_uuid(), 'notifications.retry', 'Retry dead-letter notification deliveries.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

-- Forced RLS requires an explicit tenant context while standard roles are
-- reconciled. Administrators and QA managers can operate delivery recovery;
-- auditors receive read-only visibility.
DO $$
DECLARE
  target_tenant_id UUID;
BEGIN
  FOR target_tenant_id IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', target_tenant_id::text, true);

    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT role.tenant_id, role.id, permission.id
    FROM "roles" role
    CROSS JOIN "permissions" permission
    WHERE role.tenant_id = target_tenant_id
      AND (
        (role.name IN ('Administrator', 'QA Manager') AND permission.code IN ('notifications.read', 'notifications.retry'))
        OR (role.name = 'Auditor' AND permission.code = 'notifications.read')
      )
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END;
$$;
