import 'dotenv/config';
import {
  createDatabaseBackup,
  loadRecoveryConfiguration,
} from './lib/database-recovery.mjs';

try {
  const result = await createDatabaseBackup(loadRecoveryConfiguration());
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'created',
        archivePath: result.archivePath,
        manifestPath: result.manifestPath,
        sha256: result.manifest.archive.sha256,
        sizeBytes: result.manifest.archive.sizeBytes,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Database backup failed.'}\n`,
  );
  process.exitCode = 1;
}
