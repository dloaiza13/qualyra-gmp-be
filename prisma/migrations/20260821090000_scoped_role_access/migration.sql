INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'documents.read_all', 'View every controlled document and draft in the organization.'),
  (gen_random_uuid(), 'deviations.read_all', 'View every deviation in the organization.'),
  (gen_random_uuid(), 'capas.read_all', 'View every CAPA plan in the organization.'),
  (gen_random_uuid(), 'changes.read_all', 'View every change control in the organization.'),
  (gen_random_uuid(), 'audits.read_all', 'View every audit and finding in the organization.'),
  (gen_random_uuid(), 'risks.read_all', 'View every quality risk assessment in the organization.'),
  (gen_random_uuid(), 'suppliers.read_all', 'View every supplier quality record in the organization.'),
  (gen_random_uuid(), 'equipment.read_all', 'View every equipment record in the organization.'),
  (gen_random_uuid(), 'complaints.read_all', 'View every product complaint in the organization.'),
  (gen_random_uuid(), 'recalls.read_all', 'View every recall and field action in the organization.'),
  (gen_random_uuid(), 'product_reviews.read_all', 'View every PQR and APR in the organization.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

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
      AND role.is_system = true
      AND (
        (
          role.name = 'Document Controller'
          AND permission.code IN (
            'deviations.read', 'deviations.create', 'deviations.investigate',
            'risks.read', 'risks.create', 'risks.mitigate',
            'suppliers.read', 'suppliers.create', 'suppliers.assess', 'suppliers.scar',
            'equipment.read', 'equipment.create', 'equipment.calibrate', 'equipment.maintain',
            'recalls.read', 'recalls.create',
            'product_reviews.read', 'product_reviews.create'
          )
        )
        OR (
          role.name = 'Operator'
          AND permission.code IN (
            'suppliers.read', 'suppliers.assess', 'suppliers.scar',
            'complaints.investigate',
            'recalls.read', 'recalls.create', 'recalls.execute',
            'product_reviews.read', 'product_reviews.prepare'
          )
        )
        OR (
          role.name = 'Auditor'
          AND permission.code IN (
            'audit.read', 'risks.review',
            'suppliers.approve', 'suppliers.review_scar',
            'equipment.verify', 'equipment.retire',
            'complaints.review',
            'recalls.approve', 'recalls.close',
            'product_reviews.approve'
          )
        )
      );

    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    JOIN (VALUES
      ('Administrator', 'documents.read_all'),
      ('Administrator', 'deviations.read_all'),
      ('Administrator', 'capas.read_all'),
      ('Administrator', 'changes.read_all'),
      ('Administrator', 'audits.read_all'),
      ('Administrator', 'risks.read_all'),
      ('Administrator', 'suppliers.read_all'),
      ('Administrator', 'equipment.read_all'),
      ('Administrator', 'complaints.read_all'),
      ('Administrator', 'recalls.read_all'),
      ('Administrator', 'product_reviews.read_all'),
      ('QA Manager', 'tenants.read'),
      ('QA Manager', 'documents.read_all'),
      ('QA Manager', 'documents.release'),
      ('QA Manager', 'deviations.read_all'),
      ('QA Manager', 'capas.read_all'),
      ('QA Manager', 'changes.read_all'),
      ('QA Manager', 'audits.read_all'),
      ('QA Manager', 'risks.read_all'),
      ('QA Manager', 'suppliers.read_all'),
      ('QA Manager', 'equipment.read_all'),
      ('QA Manager', 'complaints.read_all'),
      ('QA Manager', 'recalls.read_all'),
      ('QA Manager', 'product_reviews.read_all'),
      ('Document Controller', 'documents.read_all'),
      ('Document Controller', 'training.read'),
      ('Document Controller', 'training.assign'),
      ('Document Controller', 'training.complete'),
      ('Operator', 'training.read'),
      ('Operator', 'training.complete'),
      ('Auditor', 'documents.read_all'),
      ('Auditor', 'training.read'),
      ('Auditor', 'training.complete'),
      ('Auditor', 'deviations.read_all'),
      ('Auditor', 'capas.read_all'),
      ('Auditor', 'changes.read_all'),
      ('Auditor', 'audits.read_all'),
      ('Auditor', 'risks.read_all'),
      ('Auditor', 'suppliers.read_all'),
      ('Auditor', 'equipment.read_all'),
      ('Auditor', 'complaints.read_all'),
      ('Auditor', 'recalls.read_all'),
      ('Auditor', 'product_reviews.read_all')
    ) AS grant_map(role_name, permission_code)
      ON grant_map.role_name = role.name
    JOIN "permissions" permission
      ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id
      AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
