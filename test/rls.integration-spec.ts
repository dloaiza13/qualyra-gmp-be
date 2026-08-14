import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DatabaseError, Pool, type PoolClient } from 'pg';

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

interface Fixture {
  tenantAId: string;
  tenantBId: string;
  userAId: string;
  userBId: string;
  roleAId: string;
  roleBId: string;
}

const tenantScopedTables = [
  'email_verification_tokens',
  'invitation_roles',
  'invitations',
  'outbox_messages',
  'password_reset_tokens',
  'refresh_tokens',
  'role_permissions',
  'roles',
  'security_events',
  'sessions',
  'user_roles',
  'users',
] as const;

describeDatabase('PostgreSQL tenant isolation', () => {
  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
  const applicationDatabaseUrl = process.env.DATABASE_URL;

  if (!migrationDatabaseUrl || !applicationDatabaseUrl) {
    throw new Error(
      'MIGRATION_DATABASE_URL and DATABASE_URL are required for integration tests.',
    );
  }

  const ownerPool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 2,
  });
  const applicationPool = new Pool({
    connectionString: applicationDatabaseUrl,
    max: 2,
  });
  const fixture: Fixture = {
    tenantAId: randomUUID(),
    tenantBId: randomUUID(),
    userAId: randomUUID(),
    userBId: randomUUID(),
    roleAId: randomUUID(),
    roleBId: randomUUID(),
  };

  beforeAll(async () => {
    await createTenantFixture(ownerPool, {
      tenantId: fixture.tenantAId,
      tenantSlug: `rls-a-${fixture.tenantAId.slice(0, 8)}`,
      userId: fixture.userAId,
      userEmail: `user-a-${fixture.userAId}@example.test`,
      roleId: fixture.roleAId,
    });
    await createTenantFixture(ownerPool, {
      tenantId: fixture.tenantBId,
      tenantSlug: `rls-b-${fixture.tenantBId.slice(0, 8)}`,
      userId: fixture.userBId,
      userEmail: `user-b-${fixture.userBId}@example.test`,
      roleId: fixture.roleBId,
    });
  });

  afterAll(async () => {
    await deleteTenantFixture(ownerPool, fixture.tenantAId);
    await deleteTenantFixture(ownerPool, fixture.tenantBId);
    await applicationPool.end();
    await ownerPool.end();
  });

  it('returns only rows belonging to the transaction tenant', async () => {
    const tenantAUsers = await readUserIds(applicationPool, fixture.tenantAId);
    const tenantBUsers = await readUserIds(applicationPool, fixture.tenantBId);

    expect(tenantAUsers).toEqual([fixture.userAId]);
    expect(tenantBUsers).toEqual([fixture.userBId]);
  });

  it('returns no tenant rows without a tenant context', async () => {
    const result = await applicationPool.query<{ id: string }>(
      'SELECT id FROM users',
    );

    expect(result.rows).toEqual([]);
  });

  it('enforces and forces RLS on every tenant-scoped table', async () => {
    const result = await ownerPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname = ANY($1::text[])
       ORDER BY relname`,
      [[...tenantScopedTables]],
    );

    expect(result.rows).toHaveLength(tenantScopedTables.length);
    expect(result.rows.map(({ relname }) => relname)).toEqual([
      ...tenantScopedTables,
    ]);
    expect(
      result.rows.every(
        ({ relrowsecurity, relforcerowsecurity }) =>
          relrowsecurity && relforcerowsecurity,
      ),
    ).toBe(true);
  });

  it('connects with a non-privileged application role', async () => {
    const result = await applicationPool.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      runtime_member: boolean;
    }>(
      `SELECT
         rolsuper,
         rolcreatedb,
         rolcreaterole,
         rolbypassrls,
         pg_has_role(current_user, 'qualyra_runtime', 'member') AS runtime_member
       FROM pg_roles
       WHERE rolname = current_user`,
    );

    expect(result.rows).toEqual([
      {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
        runtime_member: true,
      },
    ]);
  });

  it('prevents the application role from changing the permission catalog', async () => {
    await expect(
      applicationPool.query(
        `INSERT INTO permissions (id, code, description)
         VALUES ($1, $2, $3)`,
        [
          randomUUID(),
          `forbidden.${randomUUID()}`,
          'Forbidden test permission',
        ],
      ),
    ).rejects.toMatchObject<Partial<DatabaseError>>({ code: '42501' });
  });

  it('prevents the application role from creating schema objects', async () => {
    await expect(
      applicationPool.query(
        `CREATE TABLE forbidden_application_table (id UUID PRIMARY KEY)`,
      ),
    ).rejects.toMatchObject<Partial<DatabaseError>>({ code: '42501' });
  });

  it('rejects assigning a role from another tenant', async () => {
    const client = await applicationPool.connect();

    try {
      await client.query('BEGIN');
      await setTenantContext(client, fixture.tenantAId);

      await expect(
        client.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id)
           VALUES ($1, $2, $3)`,
          [fixture.tenantAId, fixture.userAId, fixture.roleBId],
        ),
      ).rejects.toMatchObject<Partial<DatabaseError>>({ code: '23503' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('prevents mutation of security events', async () => {
    const client = await applicationPool.connect();
    const eventId = randomUUID();

    try {
      await client.query('BEGIN');
      await setTenantContext(client, fixture.tenantAId);
      await client.query(
        `INSERT INTO security_events (
           id, tenant_id, actor_user_id, event_type, outcome, correlation_id
         ) VALUES ($1, $2, $3, 'RLS_TEST', 'SUCCESS', $4)`,
        [eventId, fixture.tenantAId, fixture.userAId, randomUUID()],
      );

      await expect(
        client.query(
          'UPDATE security_events SET event_type = $1 WHERE id = $2',
          ['MUTATED', eventId],
        ),
      ).rejects.toBeInstanceOf(DatabaseError);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

async function setTenantContext(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [
    tenantId,
  ]);
}

async function readUserIds(pool: Pool, tenantId: string): Promise<string[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);
    const result = await client.query<{ id: string }>(
      'SELECT id FROM users ORDER BY id',
    );
    await client.query('COMMIT');
    return result.rows.map(({ id }) => id);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createTenantFixture(
  pool: Pool,
  values: {
    tenantId: string;
    tenantSlug: string;
    userId: string;
    userEmail: string;
    roleId: string;
  },
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenants (id, name, slug, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [values.tenantId, `RLS ${values.tenantSlug}`, values.tenantSlug],
    );
    await setTenantContext(client, values.tenantId);
    await client.query(
      `INSERT INTO users (
         id, tenant_id, email, display_name, password_hash, updated_at
       ) VALUES ($1, $2, $3, 'RLS Test User', 'not-a-password', CURRENT_TIMESTAMP)`,
      [values.userId, values.tenantId, values.userEmail],
    );
    await client.query(
      `INSERT INTO roles (id, tenant_id, name, updated_at)
       VALUES ($1, $2, 'RLS Test Role', CURRENT_TIMESTAMP)`,
      [values.roleId, values.tenantId],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteTenantFixture(
  pool: Pool,
  tenantId: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);
    await client.query('DELETE FROM user_roles WHERE tenant_id = $1', [
      tenantId,
    ]);
    await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM roles WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
