CREATE TYPE "SubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'GRACE_PERIOD',
  'CANCEL_SCHEDULED',
  'CANCELED',
  'EXPIRED'
);

CREATE TYPE "BillingInterval" AS ENUM (
  'NONE',
  'MONTHLY',
  'ANNUAL',
  'CUSTOM'
);

CREATE TYPE "BillingProviderEventStatus" AS ENUM (
  'PROCESSED',
  'IGNORED'
);

CREATE TABLE "tenant_subscriptions" (
  "tenant_id" UUID NOT NULL,
  "status" "SubscriptionStatus" NOT NULL,
  "billing_interval" "BillingInterval" NOT NULL DEFAULT 'NONE',
  "provider" VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  "provider_customer_id" VARCHAR(200),
  "provider_subscription_id" VARCHAR(200),
  "current_period_starts_at" TIMESTAMPTZ(3),
  "current_period_ends_at" TIMESTAMPTZ(3),
  "grace_ends_at" TIMESTAMPTZ(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "canceled_at" TIMESTAMPTZ(3),
  "last_provider_event_at" TIMESTAMPTZ(3),
  "last_provider_event_id" VARCHAR(200),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "tenant_subscriptions_status_period_idx"
  ON "tenant_subscriptions"("status", "current_period_ends_at");
CREATE INDEX "tenant_subscriptions_provider_reference_idx"
  ON "tenant_subscriptions"("provider", "provider_subscription_id");

INSERT INTO "tenant_subscriptions" (
  "tenant_id",
  "status",
  "billing_interval",
  "current_period_starts_at",
  "current_period_ends_at",
  "updated_at"
)
SELECT
  "id",
  CASE
    WHEN "plan" = 'TRIAL' AND ("trial_ends_at" IS NULL OR "trial_ends_at" <= CURRENT_TIMESTAMP)
      THEN 'EXPIRED'::"SubscriptionStatus"
    WHEN "plan" = 'TRIAL'
      THEN 'TRIALING'::"SubscriptionStatus"
    ELSE 'ACTIVE'::"SubscriptionStatus"
  END,
  CASE
    WHEN "plan" = 'TRIAL' THEN 'NONE'::"BillingInterval"
    ELSE 'MONTHLY'::"BillingInterval"
  END,
  "created_at",
  CASE WHEN "plan" = 'TRIAL' THEN "trial_ends_at" ELSE NULL END,
  CURRENT_TIMESTAMP
FROM "tenants";

CREATE TABLE "billing_provider_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID,
  "provider" VARCHAR(50) NOT NULL,
  "provider_event_id" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "status" "BillingProviderEventStatus" NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "metadata" JSONB,
  "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_provider_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_provider_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "billing_provider_events_provider_event_key"
  ON "billing_provider_events"("provider", "provider_event_id");
CREATE INDEX "billing_provider_events_tenant_processed_idx"
  ON "billing_provider_events"("tenant_id", "processed_at" DESC);
CREATE INDEX "billing_provider_events_cursor_idx"
  ON "billing_provider_events"("processed_at" DESC, "id" DESC);

ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_subscriptions_tenant_isolation"
  ON "tenant_subscriptions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION public.prevent_billing_provider_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'billing_provider_events is append-only'
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION public.prevent_billing_provider_event_mutation() FROM PUBLIC;

CREATE TRIGGER billing_provider_events_prevent_update_delete
BEFORE UPDATE OR DELETE ON "billing_provider_events"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_billing_provider_event_mutation();

GRANT SELECT, INSERT, UPDATE ON TABLE "tenant_subscriptions" TO qualyra_runtime;
REVOKE DELETE ON TABLE "tenant_subscriptions" FROM qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "billing_provider_events" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "billing_provider_events" FROM qualyra_runtime;
