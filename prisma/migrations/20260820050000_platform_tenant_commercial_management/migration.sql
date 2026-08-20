CREATE TABLE "platform_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID,
  "operator_id" VARCHAR(100) NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "outcome" "SecurityEventOutcome" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "ip_address" INET,
  "user_agent" VARCHAR(1024),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "platform_audit_events_cursor_idx"
  ON "platform_audit_events"("created_at" DESC, "id" DESC);
CREATE INDEX "platform_audit_events_tenant_created_idx"
  ON "platform_audit_events"("tenant_id", "created_at" DESC);
CREATE INDEX "tenants_status_plan_created_id_idx"
  ON "tenants"("status", "plan", "created_at" DESC, "id" DESC);

CREATE FUNCTION public.prevent_platform_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only'
    USING ERRCODE = '55000';
END
$$;

REVOKE ALL ON FUNCTION public.prevent_platform_audit_event_mutation() FROM PUBLIC;

CREATE TRIGGER platform_audit_events_prevent_update_delete
BEFORE UPDATE OR DELETE ON "platform_audit_events"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_platform_audit_event_mutation();

GRANT SELECT, INSERT ON TABLE "platform_audit_events" TO qualyra_runtime;
REVOKE UPDATE, DELETE ON TABLE "platform_audit_events" FROM qualyra_runtime;
