INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'reports.read', 'View organization-wide quality reports and analytics.')
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
      AND permission.code = 'reports.read'
      AND role.name IN (
        'Administrator', 'QA Manager', 'Document Controller', 'Auditor'
      )
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
