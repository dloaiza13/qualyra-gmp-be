DO $$
DECLARE tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

    DELETE FROM "role_permissions" role_permission
    USING "roles" role, "permissions" permission
    WHERE role_permission.tenant_id = tenant_record.id
      AND role_permission.role_id = role.id
      AND role_permission.permission_id = permission.id
      AND role.tenant_id = tenant_record.id
      AND role.name <> 'Administrator'
      AND (
        permission.code = 'tenants.read'
        OR permission.code LIKE 'users.%'
        OR permission.code LIKE 'roles.%'
      );
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
