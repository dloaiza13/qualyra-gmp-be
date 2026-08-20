import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Client, Pool } from 'pg';

const tenantCount = integerEnvironment(
  'QUALYRA_CAPACITY_DRILL_TENANTS',
  50,
  1,
  500,
);
const photosPerTenant = integerEnvironment(
  'QUALYRA_CAPACITY_DRILL_PHOTOS_PER_TENANT',
  20,
  1,
  1_000,
);
const maximumP95Ms = integerEnvironment(
  'QUALYRA_CAPACITY_DRILL_MAX_P95_MS',
  250,
  1,
  60_000,
);
const databaseName = `qualyra_capacity_drill_${Date.now()}_${randomBytes(3).toString('hex')}`;

assertSafeDatabaseName(databaseName);
const ownerUrl = requiredPostgresUrl('MIGRATION_DATABASE_URL');
const runtimeUrl = requiredPostgresUrl('DATABASE_URL');
const ownerRole = decodeURIComponent(ownerUrl.username);
assertSafeRoleName(ownerRole);
const administrationUrl = withDatabase(ownerUrl, 'postgres');
const drillOwnerUrl = withDatabase(ownerUrl, databaseName);
const drillRuntimeUrl = withDatabase(runtimeUrl, databaseName);
let databaseCreated = false;

try {
  await createDatabase();
  databaseCreated = true;
  await migrateDatabase();
  const tenants = await loadCapacityFixture();
  const result = await measureRuntimeReads(tenants);
  if (result.p95Ms > maximumP95Ms) {
    throw new Error(
      `Capacity drill p95 ${result.p95Ms.toFixed(2)} ms exceeded ${maximumP95Ms} ms.`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'verified',
        isolation: 'passed',
        database: 'temporary database removed after verification',
        tenants: tenantCount,
        photosPerTenant,
        totalPhotoMetadata: tenantCount * photosPerTenant,
        concurrentDatabaseConnections: 10,
        latencyMs: result,
        maximumP95Ms,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (databaseCreated) await dropDatabase();
}

async function createDatabase() {
  const client = new Client({ connectionString: administrationUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `CREATE DATABASE "${databaseName}" OWNER "${ownerRole}"`,
    );
  } finally {
    await client.end();
  }
}

async function migrateDatabase() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: drillRuntimeUrl.toString(),
          MIGRATION_DATABASE_URL: drillOwnerUrl.toString(),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Temporary database migration exited with code ${code}.`),
          ),
    );
  });
}

async function loadCapacityFixture() {
  const client = new Client({ connectionString: drillOwnerUrl.toString() });
  const tenants = [];
  await client.connect();
  try {
    for (let index = 0; index < tenantCount; index += 1) {
      const tenantId = randomUUID();
      const userId = randomUUID();
      tenants.push({ tenantId, userId });
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO tenants (id, name, slug, status, plan, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', 'PROFESSIONAL', CURRENT_TIMESTAMP)`,
          [tenantId, `Capacity tenant ${index + 1}`, `capacity-${index + 1}`],
        );
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        await client.query(
          `INSERT INTO users (
             id, tenant_id, email, display_name, password_hash, status, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)`,
          [
            userId,
            tenantId,
            `capacity-${index + 1}@invalid.local`,
            `Capacity user ${index + 1}`,
            'capacity-drill-account-cannot-login',
          ],
        );
        await client.query(
          `INSERT INTO photo_evidence (
             id, tenant_id, subject_type, subject_id, file_name, content_type,
             size_bytes, sha256, object_key, storage_driver, scan_engine,
             scan_result, scanned_at, uploaded_by_user_id
           )
           SELECT
             gen_random_uuid(), $1::uuid, 'DEVIATION', gen_random_uuid(),
             'capacity.jpg', 'image/jpeg', 1024,
             lpad(to_hex(($2::bigint * 100000) + item), 64, '0'),
             ($1::uuid)::text || '/capacity/' || item::text, 'S3', 'CAPACITY_DRILL',
             'SAFE', CURRENT_TIMESTAMP, $3::uuid
           FROM generate_series(1, $4::integer) AS item`,
          [tenantId, index + 1, userId, photosPerTenant],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
  return tenants;
}

async function measureRuntimeReads(tenants) {
  const pool = new Pool({
    connectionString: drillRuntimeUrl.toString(),
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const latencies = await Promise.all(
      tenants.map(async ({ tenantId }, index) => {
        const client = await pool.connect();
        const startedAt = performance.now();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            tenantId,
          ]);
          const usage = await client.query(
            `SELECT used_bytes, photo_count
             FROM tenant_photo_evidence_usage
             WHERE tenant_id = $1`,
            [tenantId],
          );
          const otherTenantId = tenants[(index + 1) % tenants.length].tenantId;
          const isolation = await client.query(
            `SELECT count(*)::integer AS count
             FROM photo_evidence
             WHERE tenant_id = $1`,
            [otherTenantId],
          );
          await client.query('COMMIT');
          const row = usage.rows[0];
          if (
            usage.rowCount !== 1 ||
            Number(row.used_bytes) !== photosPerTenant * 1024 ||
            row.photo_count !== photosPerTenant
          ) {
            throw new Error(`Incorrect usage counter for tenant ${index + 1}.`);
          }
          if (isolation.rows[0].count !== 0) {
            throw new Error(`Tenant isolation failed for tenant ${index + 1}.`);
          }
          return performance.now() - startedAt;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }),
    );
    latencies.sort((left, right) => left - right);
    return {
      minimum: round(latencies[0]),
      p50Ms: round(percentile(latencies, 0.5)),
      p95Ms: round(percentile(latencies, 0.95)),
      maximum: round(latencies.at(-1)),
    };
  } finally {
    await pool.end();
  }
}

async function dropDatabase() {
  assertSafeDatabaseName(databaseName);
  const client = new Client({ connectionString: administrationUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await client.end();
  }
}

function requiredPostgresUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }
  return url;
}

function withDatabase(source, database) {
  const result = new URL(source);
  result.pathname = `/${database}`;
  return result;
}

function assertSafeDatabaseName(value) {
  if (!/^qualyra_capacity_drill_[0-9]+_[0-9a-f]{6}$/.test(value)) {
    throw new Error(
      'Refusing to manage a database outside the capacity drill prefix.',
    );
  }
}

function assertSafeRoleName(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      'The migration role name is not a safe PostgreSQL identifier.',
    );
  }
}

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function percentile(sortedValues, fraction) {
  return sortedValues[
    Math.min(
      sortedValues.length - 1,
      Math.ceil(sortedValues.length * fraction) - 1,
    )
  ];
}

function round(value) {
  return Number(value.toFixed(2));
}
