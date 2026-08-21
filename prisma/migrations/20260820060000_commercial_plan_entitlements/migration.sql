ALTER TABLE "tenants"
ADD COLUMN "trial_ends_at" TIMESTAMPTZ(3);

UPDATE "tenants"
SET "trial_ends_at" = "created_at" + INTERVAL '30 days'
WHERE "plan" = 'TRIAL';

COMMENT ON COLUMN "tenants"."trial_ends_at" IS
'Commercial trial expiration. Expiration preserves tenant data in read-only mode.';
