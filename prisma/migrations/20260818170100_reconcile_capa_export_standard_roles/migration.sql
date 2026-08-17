-- Forced RLS hides existing role rows from a migrator without tenant context.
-- Reconcile the Phase 20 additive standard-role grant one tenant at a time.
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
      AND permission.code = 'capas.export'
      AND role.name IN ('Administrator', 'QA Manager', 'Auditor')
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
END;
$$;
