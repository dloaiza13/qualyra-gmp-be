-- QA Managers assign qualified users throughout document, deviation, and CAPA
-- workflows. Read-only directory visibility makes those granted operations usable
-- without adding user, role, invitation, or permission-management authority.
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
      AND role.name = 'QA Manager'
      AND permission.code IN ('users.read', 'roles.read')
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
