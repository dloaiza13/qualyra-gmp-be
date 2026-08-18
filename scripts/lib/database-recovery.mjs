import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';

const { Client } = pg;

const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const restoreDatabasePrefix = 'qualyra_restore_drill_';

export function loadRecoveryConfiguration(environment = process.env) {
  const configuration = {
    backupRoot: resolve(environment.QUALYRA_BACKUP_ROOT ?? './.local/backups'),
    database: required(environment.POSTGRES_DB, 'POSTGRES_DB'),
    backupUser: environment.QUALYRA_BACKUP_USER ?? 'postgres',
    backupPassword: required(
      environment.QUALYRA_BACKUP_PASSWORD ??
        environment.POSTGRES_SUPERUSER_PASSWORD,
      'QUALYRA_BACKUP_PASSWORD or POSTGRES_SUPERUSER_PASSWORD',
    ),
    appUser: required(environment.POSTGRES_APP_USER, 'POSTGRES_APP_USER'),
    appPassword: required(
      environment.POSTGRES_APP_PASSWORD,
      'POSTGRES_APP_PASSWORD',
    ),
    postgresService: environment.QUALYRA_POSTGRES_SERVICE ?? 'postgres',
    postgresHost: environment.QUALYRA_POSTGRES_HOST ?? '127.0.0.1',
    postgresPort: Number(environment.POSTGRES_PORT ?? 5432),
  };
  for (const [name, value] of [
    ['POSTGRES_DB', configuration.database],
    ['QUALYRA_BACKUP_USER', configuration.backupUser],
    ['POSTGRES_APP_USER', configuration.appUser],
    ['QUALYRA_POSTGRES_SERVICE', configuration.postgresService],
  ]) {
    if (!identifierPattern.test(value)) {
      throw new Error(`${name} must be a safe PostgreSQL identifier.`);
    }
  }
  if (
    !Number.isSafeInteger(configuration.postgresPort) ||
    configuration.postgresPort < 1 ||
    configuration.postgresPort > 65_535
  ) {
    throw new Error('POSTGRES_PORT must be a valid TCP port.');
  }
  return configuration;
}

export async function createDatabaseBackup(configuration) {
  await mkdir(configuration.backupRoot, { recursive: true });
  const backupId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const baseName = `qualyra-gmp-${timestamp}-${backupId.slice(0, 8)}`;
  const archivePath = resolve(configuration.backupRoot, `${baseName}.dump`);
  const partialPath = `${archivePath}.partial`;
  const manifestPath = resolve(
    configuration.backupRoot,
    `${baseName}.manifest.json`,
  );
  const snapshotClient = new Client({
    host: configuration.postgresHost,
    port: configuration.postgresPort,
    database: configuration.database,
    user: configuration.backupUser,
    password: configuration.backupPassword,
    application_name: 'qualyra-backup',
  });
  try {
    await snapshotClient.connect();
    await snapshotClient.query(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    );
    const snapshotResult = await snapshotClient.query(
      'SELECT pg_export_snapshot() AS snapshot_id;',
    );
    const snapshotId = snapshotResult.rows[0]?.snapshot_id;
    if (typeof snapshotId !== 'string' || !snapshotId) {
      throw new Error('PostgreSQL did not provide a backup snapshot.');
    }
    const sourceResult = await snapshotClient.query(databaseSnapshotSql);
    const source = JSON.parse(sourceResult.rows[0]?.snapshot ?? 'null');
    await runDockerToFile(
      configuration,
      configuration.backupUser,
      configuration.backupPassword,
      [
        'pg_dump',
        '--username',
        configuration.backupUser,
        '--dbname',
        configuration.database,
        '--format=custom',
        '--compress=zstd:6',
        '--snapshot',
        snapshotId,
      ],
      partialPath,
    );
    await snapshotClient.query('COMMIT;');
    await rename(partialPath, archivePath);
    const archive = await describeArchive(archivePath);
    const manifest = {
      schemaVersion: 'qualyra.database-backup.v1',
      backupId,
      createdAt: new Date().toISOString(),
      source,
      archive: {
        fileName: basename(archivePath),
        format: 'PG_DUMP_CUSTOM',
        sizeBytes: archive.sizeBytes,
        sha256: archive.sha256,
      },
      classification: {
        containsTenantData: true,
        containsPersonalData: true,
        encryption: 'DEPLOYMENT_CONTROLLED',
      },
    };
    await writeJsonAtomically(manifestPath, manifest);
    return { archivePath, manifestPath, manifest };
  } catch (error) {
    await snapshotClient.query('ROLLBACK;').catch(() => undefined);
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    await snapshotClient.end().catch(() => undefined);
  }
}

export async function runRestoreDrill(configuration, requestedManifestPath) {
  const manifestPath = requestedManifestPath
    ? resolve(requestedManifestPath)
    : await findLatestManifest(configuration.backupRoot);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  const archivePath = resolve(dirname(manifestPath), manifest.archive.fileName);
  if (
    basename(archivePath) !== manifest.archive.fileName ||
    dirname(archivePath) !== dirname(manifestPath)
  ) {
    throw new Error('The backup manifest contains an unsafe archive path.');
  }
  const archive = await describeArchive(archivePath);
  if (
    archive.sha256 !== manifest.archive.sha256 ||
    archive.sizeBytes !== manifest.archive.sizeBytes
  ) {
    throw new Error(
      'The backup archive does not match its integrity manifest.',
    );
  }

  const drillId = randomUUID();
  const temporaryDatabase = `${restoreDatabasePrefix}${drillId.replaceAll('-', '').slice(0, 20)}`;
  assertRestoreDatabaseName(temporaryDatabase);
  const startedAt = Date.now();
  let created = false;
  try {
    await runDockerText(
      configuration,
      configuration.backupUser,
      configuration.backupPassword,
      [
        'createdb',
        '--username',
        configuration.backupUser,
        '--template',
        'template0',
        temporaryDatabase,
      ],
    );
    created = true;
    await runDockerWithInput(
      configuration,
      configuration.backupUser,
      configuration.backupPassword,
      [
        'pg_restore',
        '--username',
        configuration.backupUser,
        '--dbname',
        temporaryDatabase,
        '--exit-on-error',
      ],
      archivePath,
    );
    const restored = await readDatabaseSnapshot(
      configuration,
      temporaryDatabase,
      configuration.backupUser,
      configuration.backupPassword,
    );
    assertSnapshotsMatch(manifest.source, restored);
    const isolatedTenantRows = Number(
      await queryDatabase(
        configuration,
        temporaryDatabase,
        configuration.appUser,
        configuration.appPassword,
        'SELECT count(*) FROM users;',
      ),
    );
    if (isolatedTenantRows !== 0) {
      throw new Error(
        'The restored runtime role could read tenant rows without tenant context.',
      );
    }
    const report = {
      schemaVersion: 'qualyra.restore-drill.v1',
      drillId,
      backupId: manifest.backupId,
      archiveSha256: archive.sha256,
      verifiedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      result: 'PASSED',
      checks: {
        archiveIntegrity: 'PASSED',
        schemaAndCounts: 'PASSED',
        runtimeRlsWithoutContext: 'PASSED',
      },
      restored,
    };
    const reportPath = resolve(
      dirname(manifestPath),
      `${basename(manifestPath, '.manifest.json')}.restore-drill.json`,
    );
    await writeJsonAtomically(reportPath, report);
    return { reportPath, report };
  } finally {
    if (created) {
      assertRestoreDatabaseName(temporaryDatabase);
      await runDockerText(
        configuration,
        configuration.backupUser,
        configuration.backupPassword,
        [
          'dropdb',
          '--username',
          configuration.backupUser,
          '--if-exists',
          '--force',
          temporaryDatabase,
        ],
      );
    }
  }
}

async function readDatabaseSnapshot(configuration, database, user, password) {
  const result = await queryDatabase(
    configuration,
    database,
    user,
    password,
    databaseSnapshotSql,
  );
  return JSON.parse(result);
}

const databaseSnapshotSql = `SELECT json_build_object(
      'database', current_database(),
      'postgresVersion', current_setting('server_version'),
      'migrationCount', (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
      'latestMigration', COALESCE((SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1), ''),
      'counts', json_build_object(
        'tenants', (SELECT count(*) FROM tenants),
        'users', (SELECT count(*) FROM users),
        'documents', (SELECT count(*) FROM documents),
        'trainingAssignments', (SELECT count(*) FROM training_assignments),
        'deviations', (SELECT count(*) FROM deviations),
        'capas', (SELECT count(*) FROM capas),
        'capaEvidenceUploads', (SELECT count(*) FROM capa_evidence_uploads),
        'capaAuditExports', (SELECT count(*) FROM capa_audit_exports),
        'securityEvents', (SELECT count(*) FROM security_events)
      )
    )::text AS snapshot;`;

async function queryDatabase(configuration, database, user, password, sql) {
  return runDockerText(configuration, user, password, [
    'psql',
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--username',
    user,
    '--dbname',
    database,
    '--command',
    sql,
  ]);
}

async function describeArchive(path) {
  const file = await stat(path);
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return { sizeBytes: file.size, sha256: hash.digest('hex') };
}

async function findLatestManifest(root) {
  const names = (await readdir(root))
    .filter((name) => name.endsWith('.manifest.json'))
    .sort()
    .reverse();
  if (!names[0]) throw new Error(`No backup manifest was found in ${root}.`);
  return resolve(root, names[0]);
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 'qualyra.database-backup.v1' ||
    typeof manifest.backupId !== 'string' ||
    typeof manifest.archive?.fileName !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.archive?.sha256 ?? '') ||
    !Number.isSafeInteger(manifest.archive?.sizeBytes) ||
    typeof manifest.source?.latestMigration !== 'string' ||
    !Number.isSafeInteger(manifest.source?.migrationCount) ||
    typeof manifest.source?.counts !== 'object'
  ) {
    throw new Error('The backup manifest is invalid or unsupported.');
  }
}

function assertSnapshotsMatch(expected, actual) {
  const comparableExpected = {
    postgresVersion: expected.postgresVersion,
    migrationCount: expected.migrationCount,
    latestMigration: expected.latestMigration,
    counts: expected.counts,
  };
  const comparableActual = {
    postgresVersion: actual.postgresVersion,
    migrationCount: actual.migrationCount,
    latestMigration: actual.latestMigration,
    counts: actual.counts,
  };
  if (JSON.stringify(comparableExpected) !== JSON.stringify(comparableActual)) {
    throw new Error(
      'The restored database does not match the backup manifest snapshot.',
    );
  }
}

function assertRestoreDatabaseName(database) {
  if (
    !database.startsWith(restoreDatabasePrefix) ||
    !identifierPattern.test(database)
  ) {
    throw new Error('Refusing to operate on an unsafe restore database name.');
  }
}

async function writeJsonAtomically(path, value) {
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await rename(partialPath, path);
}

async function runDockerToFile(
  configuration,
  user,
  password,
  command,
  outputPath,
) {
  const child = spawnDocker(configuration, user, password, command);
  const errors = collect(child.stderr);
  await Promise.all([
    pipeline(
      child.stdout,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    ),
    waitForExit(child, errors),
  ]);
}

async function runDockerWithInput(
  configuration,
  user,
  password,
  command,
  inputPath,
) {
  const file = await open(inputPath, 'r');
  try {
    const child = spawnDocker(configuration, user, password, command, file.fd);
    const output = collect(child.stdout);
    const errors = collect(child.stderr);
    await waitForExit(child, errors, output);
  } finally {
    await file.close();
  }
}

async function runDockerText(configuration, user, password, command) {
  const child = spawnDocker(configuration, user, password, command);
  const output = collect(child.stdout);
  const errors = collect(child.stderr);
  await waitForExit(child, errors, output);
  return (await output).trim();
}

function spawnDocker(configuration, user, password, command, stdin) {
  void user;
  return spawn(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      'PGPASSWORD',
      configuration.postgresService,
      ...command,
    ],
    {
      env: { ...process.env, PGPASSWORD: password },
      stdio: [stdin ?? 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}

function collect(stream) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 1_048_576) chunks.push(chunk);
    });
    stream.on('end', () =>
      resolvePromise(Buffer.concat(chunks).toString('utf8')),
    );
    stream.on('error', reject);
  });
}

async function waitForExit(child, errors, output = Promise.resolve('')) {
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', resolvePromise);
  });
  const [stderr, stdout] = await Promise.all([errors, output]);
  if (code !== 0) {
    throw new Error(
      `PostgreSQL recovery command failed (${code}): ${stderr.trim() || stdout.trim() || 'no diagnostic output'}`,
    );
  }
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required for database recovery.`);
  return value;
}
