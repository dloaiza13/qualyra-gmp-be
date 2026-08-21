import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;
const confirmation = process.env.QA_RESET_CONFIRM;
const password = process.env.QA_DEFAULT_PASSWORD;
const databaseUrl = process.env.MIGRATION_DATABASE_URL;

if (confirmation !== 'RESET_LOCAL_QA') {
  throw new Error('QA_RESET_CONFIRM=RESET_LOCAL_QA is required.');
}
if (!password || password.length < 12 || password.length > 128) {
  throw new Error(
    'QA_DEFAULT_PASSWORD must contain between 12 and 128 characters.',
  );
}
if (!databaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required.');
}

const parsedDatabaseUrl = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname)) {
  throw new Error(
    'The functional QA reset can only run against a local database.',
  );
}

const sourceTenantSlug = process.env.QA_SOURCE_TENANT_SLUG ?? 'qualyra-demo';
const targetTenantName = 'Qualyra QA';
const targetTenantSlug = 'qualyra-demo';
const tenantId = randomUUID();
const now = new Date();
const users = [
  {
    email: 'admin@qualyra.local',
    displayName: 'Administrador QA',
    role: 'Administrator',
  },
  {
    email: 'controller@qualyra.local',
    displayName: 'Controlador Documental QA',
    role: 'Document Controller',
  },
  {
    email: 'operator@qualyra.local',
    displayName: 'Operador QA',
    role: 'Operator',
  },
  {
    email: 'reviewer@qualyra.local',
    displayName: 'Revisor QA',
    role: 'QA Manager',
  },
  {
    email: 'approver@qualyra.local',
    displayName: 'Aprobador QA',
    role: 'QA Manager',
  },
  {
    email: 'auditor@qualyra.local',
    displayName: 'Auditor QA',
    role: 'Auditor',
  },
];
const requiredRoles = [...new Set(users.map(({ role }) => role))];

const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const roleTemplates = await readRoleTemplates(client, sourceTenantSlug);
  for (const role of requiredRoles) {
    if (!roleTemplates.has(role) || roleTemplates.get(role)?.length === 0) {
      throw new Error(
        `The source tenant does not contain a usable ${role} role.`,
      );
    }
  }

  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");
  const tables = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> ALL($1::text[])
     ORDER BY tablename`,
    [['_prisma_migrations', 'permissions']],
  );
  const truncateTargets = tables.rows
    .map(({ tablename }) => `public.${quoteIdentifier(tablename)}`)
    .join(', ');
  if (!truncateTargets.includes('public."tenants"')) {
    throw new Error('The tenant table was not selected for reset.');
  }
  await client.query(
    `TRUNCATE TABLE ${truncateTargets} RESTART IDENTITY CASCADE`,
  );

  await client.query(
    `INSERT INTO tenants (
       id, name, slug, status, plan, trial_ends_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'ACTIVE', 'ENTERPRISE', NULL, $4, $4)`,
    [tenantId, targetTenantName, targetTenantSlug, now],
  );
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [
    tenantId,
  ]);
  await client.query(
    `INSERT INTO tenant_subscriptions (
       tenant_id, status, billing_interval, provider,
       current_period_starts_at, created_at, updated_at
     ) VALUES ($1, 'ACTIVE', 'CUSTOM', 'MANUAL', $2, $2, $2)`,
    [tenantId, now],
  );
  await client.query(
    `INSERT INTO tenant_photo_evidence_usage (
       tenant_id, used_bytes, photo_count, updated_at
     ) VALUES ($1, 0, 0, $2)`,
    [tenantId, now],
  );

  const roleIds = new Map();
  for (const [roleName, permissionCodes] of roleTemplates) {
    const roleId = randomUUID();
    roleIds.set(roleName, roleId);
    await client.query(
      `INSERT INTO roles (
         id, tenant_id, name, description, is_system, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, true, $5, $5)`,
      [
        roleId,
        tenantId,
        roleName,
        `${roleName} role prepared for functional QA.`,
        now,
      ],
    );
    const inserted = await client.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission_id, created_at)
       SELECT $1, $2, id, $4
       FROM permissions
       WHERE code = ANY($3::text[])`,
      [tenantId, roleId, permissionCodes, now],
    );
    if (inserted.rowCount !== permissionCodes.length) {
      throw new Error(`Not all permissions were restored for ${roleName}.`);
    }
  }

  for (const user of users) {
    const userId = randomUUID();
    const roleId = roleIds.get(user.role);
    if (!roleId) throw new Error(`Role ${user.role} was not created.`);
    await client.query(
      `INSERT INTO users (
         id, tenant_id, email, display_name, password_hash, status,
         email_verified_at, password_changed_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $6, $6, $6)`,
      [userId, tenantId, user.email, user.displayName, passwordHash, now],
    );
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, userId, roleId, now],
    );
  }

  await client.query(
    `INSERT INTO platform_audit_events (
       id, tenant_id, operator_id, event_type, outcome, reason,
       correlation_id, metadata, created_at
     ) VALUES (
       $1, $2, 'local-qa-reset', 'FUNCTIONAL_QA_BASELINE_CREATED',
       'SUCCESS', 'Local database reset to one controlled functional QA tenant.',
       $3, $4::jsonb, $5
     )`,
    [
      randomUUID(),
      tenantId,
      randomUUID(),
      JSON.stringify({ users: users.length, roles: roleIds.size }),
      now,
    ],
  );
  await client.query('COMMIT');

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'prepared',
        tenant: {
          id: tenantId,
          name: targetTenantName,
          slug: targetTenantSlug,
        },
        plan: 'ENTERPRISE',
        users: users.map(({ email, displayName, role }) => ({
          email,
          displayName,
          role,
        })),
        truncatedTables: tables.rowCount,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection may have failed before a transaction was opened.
  }
  throw error;
} finally {
  await client.end();
}

async function readRoleTemplates(database, tenantSlug) {
  const tenant = await database.query(
    'SELECT id FROM tenants WHERE slug = $1',
    [tenantSlug],
  );
  if (tenant.rowCount !== 1) {
    throw new Error(`The source tenant ${tenantSlug} was not found.`);
  }
  await database.query("SELECT set_config('app.tenant_id', $1, false)", [
    tenant.rows[0].id,
  ]);
  const result = await database.query(
    `SELECT r.name, p.code
     FROM tenants t
     JOIN roles r ON r.tenant_id = t.id
     JOIN role_permissions rp
       ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE t.slug = $1
     ORDER BY r.name, p.code`,
    [tenantSlug],
  );
  const templates = new Map();
  for (const row of result.rows) {
    const values = templates.get(row.name) ?? [];
    values.push(row.code);
    templates.set(row.name, values);
  }
  return templates;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
