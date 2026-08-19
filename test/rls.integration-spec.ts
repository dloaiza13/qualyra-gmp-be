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
  'audit_closures',
  'audit_finding_responses',
  'audit_findings',
  'audit_reports',
  'audit_sequences',
  'audits',
  'capa_action_evidence_references',
  'capa_action_extensions',
  'capa_actions',
  'capa_audit_exports',
  'capa_effectiveness_reviews',
  'capa_evidence_uploads',
  'capa_follow_up_cycles',
  'capa_notifications',
  'capa_sequences',
  'capas',
  'change_control_assessments',
  'change_control_decisions',
  'change_control_sequences',
  'change_control_tasks',
  'change_control_verifications',
  'change_controls',
  'deviation_investigations',
  'deviation_sequences',
  'deviations',
  'document_obsolescences',
  'document_periodic_reviews',
  'document_releases',
  'document_versions',
  'document_workflows',
  'documents',
  'email_verification_tokens',
  'equipment',
  'equipment_calibration_reviews',
  'equipment_calibrations',
  'equipment_maintenance_reviews',
  'equipment_maintenances',
  'equipment_sequences',
  'invitation_roles',
  'invitations',
  'outbox_messages',
  'password_reset_tokens',
  'quality_risk_assessments',
  'quality_risk_items',
  'quality_risk_reviews',
  'quality_risk_sequences',
  'refresh_tokens',
  'role_permissions',
  'roles',
  'security_events',
  'sessions',
  'supplier_qualification_decisions',
  'supplier_qualifications',
  'supplier_scar_responses',
  'supplier_scar_sequences',
  'supplier_scars',
  'supplier_sequences',
  'suppliers',
  'training_assignments',
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

  it('allows release evidence insertion but not mutation or deletion', async () => {
    const result = await applicationPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         has_table_privilege(current_user, 'document_releases', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'document_releases', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'document_releases', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'document_releases', 'DELETE') AS can_delete`,
    );

    expect(result.rows).toEqual([
      {
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
    ]);
  });

  it('allows obsolescence evidence insertion but not mutation or deletion', async () => {
    const result = await applicationPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         has_table_privilege(current_user, 'document_obsolescences', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'document_obsolescences', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'document_obsolescences', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'document_obsolescences', 'DELETE') AS can_delete`,
    );

    expect(result.rows).toEqual([
      {
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
    ]);
  });

  it('allows periodic review transitions but not evidence deletion', async () => {
    const result = await applicationPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         has_table_privilege(current_user, 'document_periodic_reviews', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'document_periodic_reviews', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'document_periodic_reviews', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'document_periodic_reviews', 'DELETE') AS can_delete`,
    );

    expect(result.rows).toEqual([
      {
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
    ]);
  });

  it('guards periodic review finalization and one pending cycle per document', async () => {
    const triggers = await ownerPool.query<{
      trigger_name: string;
      function_name: string;
    }>(
      `SELECT
         trigger.tgname AS trigger_name,
         function.proname AS function_name
       FROM pg_trigger AS trigger
       JOIN pg_proc AS function ON function.oid = trigger.tgfoid
       WHERE trigger.tgrelid = 'document_periodic_reviews'::regclass
         AND NOT trigger.tgisinternal`,
    );
    const index = await ownerPool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'document_periodic_reviews_one_pending_per_document_key'`,
    );

    expect(triggers.rows).toEqual([
      {
        trigger_name: 'document_periodic_reviews_transition_guard',
        function_name: 'guard_document_periodic_review_transition',
      },
    ]);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]?.indexdef).toContain("WHERE (status = 'PENDING'");
  });

  it('allows training finalization but protects historical evidence', async () => {
    const privileges = await applicationPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         has_table_privilege(current_user, 'training_assignments', 'SELECT') AS can_select,
         has_table_privilege(current_user, 'training_assignments', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'training_assignments', 'UPDATE') AS can_update,
         has_table_privilege(current_user, 'training_assignments', 'DELETE') AS can_delete`,
    );
    const triggers = await ownerPool.query<{
      trigger_name: string;
      function_name: string;
    }>(
      `SELECT
         trigger.tgname AS trigger_name,
         function.proname AS function_name
       FROM pg_trigger AS trigger
       JOIN pg_proc AS function ON function.oid = trigger.tgfoid
       WHERE trigger.tgrelid = 'training_assignments'::regclass
         AND NOT trigger.tgisinternal`,
    );
    const index = await ownerPool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'training_assignments_one_open_per_user_version_key'`,
    );

    expect(privileges.rows).toEqual([
      {
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
    ]);
    expect(triggers.rows).toEqual([
      {
        trigger_name: 'training_assignments_transition_guard',
        function_name: 'guard_training_assignment_transition',
      },
    ]);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]?.indexdef).toContain("WHERE (status = 'ASSIGNED'");
  });

  it('protects deviation intake, transitions, and tenant sequences', async () => {
    const privileges = await applicationPool.query<{
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         table_name,
         has_table_privilege(current_user, table_name, 'SELECT') AS can_select,
         has_table_privilege(current_user, table_name, 'INSERT') AS can_insert,
         has_table_privilege(current_user, table_name, 'UPDATE') AS can_update,
         has_table_privilege(current_user, table_name, 'DELETE') AS can_delete
       FROM unnest(ARRAY['deviation_investigations', 'deviation_sequences', 'deviations']) AS table_name
       ORDER BY table_name`,
    );
    const triggers = await ownerPool.query<{
      table_name: string;
      trigger_name: string;
      function_name: string;
    }>(
      `SELECT
         trigger.tgrelid::regclass::text AS table_name,
         trigger.tgname AS trigger_name,
         function.proname AS function_name
       FROM pg_trigger AS trigger
       JOIN pg_proc AS function ON function.oid = trigger.tgfoid
       WHERE trigger.tgrelid = ANY(
         ARRAY[
           'deviation_investigations'::regclass,
           'deviation_sequences'::regclass,
           'deviations'::regclass
         ]
       )
         AND NOT trigger.tgisinternal
       ORDER BY table_name`,
    );

    expect(privileges.rows).toEqual([
      {
        table_name: 'deviation_investigations',
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
      {
        table_name: 'deviation_sequences',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
      {
        table_name: 'deviations',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
    ]);
    expect(triggers.rows).toEqual([
      {
        table_name: 'deviation_investigations',
        trigger_name: 'deviation_investigations_prevent_update_delete',
        function_name: 'prevent_deviation_investigation_mutation',
      },
      {
        table_name: 'deviation_sequences',
        trigger_name: 'deviation_sequences_update_guard',
        function_name: 'guard_deviation_sequence_update',
      },
      {
        table_name: 'deviations',
        trigger_name: 'deviations_transition_guard',
        function_name: 'guard_deviation_transition',
      },
    ]);
  });

  it('isolates CAPA data and guards plan and action evidence', async () => {
    const privileges = await applicationPool.query<{
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT
         table_name,
         has_table_privilege(current_user, table_name, 'SELECT') AS can_select,
         has_table_privilege(current_user, table_name, 'INSERT') AS can_insert,
         has_table_privilege(current_user, table_name, 'UPDATE') AS can_update,
         has_table_privilege(current_user, table_name, 'DELETE') AS can_delete
       FROM unnest(ARRAY['capa_actions', 'capa_audit_exports', 'capa_effectiveness_reviews', 'capa_sequences', 'capas']) AS table_name
       ORDER BY table_name`,
    );
    expect(privileges.rows).toEqual([
      {
        table_name: 'capa_actions',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
      {
        table_name: 'capa_audit_exports',
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      },
      {
        table_name: 'capa_effectiveness_reviews',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
      {
        table_name: 'capa_sequences',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
      {
        table_name: 'capas',
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
      },
    ]);

    const triggers = await ownerPool.query<{
      table_name: string;
      trigger_name: string;
      function_name: string;
    }>(
      `SELECT
         trigger.tgrelid::regclass::text AS table_name,
         trigger.tgname AS trigger_name,
         procedure.proname AS function_name
       FROM pg_trigger trigger
       JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
       WHERE NOT trigger.tgisinternal
         AND trigger.tgrelid IN (
           'capa_actions'::regclass,
           'capa_audit_exports'::regclass,
           'capa_effectiveness_reviews'::regclass,
           'capa_sequences'::regclass,
           'capas'::regclass
         )
       ORDER BY table_name, trigger_name`,
    );
    expect(triggers.rows).toEqual(
      expect.arrayContaining([
        {
          table_name: 'capa_audit_exports',
          trigger_name: 'capa_audit_export_mutation_guard',
          function_name: 'guard_capa_audit_export_mutation',
        },
        {
          table_name: 'capa_actions',
          trigger_name: 'capa_actions_insert_guard',
          function_name: 'guard_capa_action_insert',
        },
        {
          table_name: 'capa_actions',
          trigger_name: 'capa_actions_transition_guard',
          function_name: 'guard_capa_action_transition',
        },
        {
          table_name: 'capa_effectiveness_reviews',
          trigger_name: 'capa_effectiveness_reviews_insert_guard',
          function_name: 'guard_capa_effectiveness_insert',
        },
        {
          table_name: 'capa_effectiveness_reviews',
          trigger_name: 'capa_effectiveness_reviews_prevent_delete',
          function_name: 'prevent_capa_effectiveness_delete',
        },
        {
          table_name: 'capa_effectiveness_reviews',
          trigger_name: 'capa_effectiveness_reviews_transition_guard',
          function_name: 'guard_capa_effectiveness_transition',
        },
        {
          table_name: 'capa_sequences',
          trigger_name: 'capa_sequences_update_guard',
          function_name: 'guard_capa_sequence_update',
        },
        {
          table_name: 'capas',
          trigger_name: 'capas_insert_guard',
          function_name: 'guard_capa_insert',
        },
        {
          table_name: 'capas',
          trigger_name: 'capas_prevent_update_delete',
          function_name: 'prevent_capa_mutation',
        },
        {
          table_name: 'capas',
          trigger_name: 'capas_require_actions',
          function_name: 'assert_capa_has_actions',
        },
      ]),
    );
  });

  it('constrains lifecycle signature meanings to their record type', async () => {
    const result = await ownerPool.query<{
      conname: string;
      definition: string;
    }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = ANY($1::text[])
       ORDER BY conname`,
      [
        [
          'document_obsolescences_meaning_check',
          'document_releases_meaning_check',
        ],
      ],
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.definition).toContain('DOCUMENT_OBSOLESCENCE');
    expect(result.rows[1]?.definition).toContain('DOCUMENT_RELEASE');
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
