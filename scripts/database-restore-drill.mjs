import 'dotenv/config';
import {
  loadRecoveryConfiguration,
  runRestoreDrill,
} from './lib/database-recovery.mjs';

const manifestArgumentIndex = process.argv.indexOf('--manifest');
const manifestPath =
  manifestArgumentIndex >= 0
    ? process.argv[manifestArgumentIndex + 1]
    : undefined;

if (manifestArgumentIndex >= 0 && !manifestPath) {
  process.stderr.write('--manifest requires a path.\n');
  process.exitCode = 1;
} else {
  try {
    const result = await runRestoreDrill(
      loadRecoveryConfiguration(),
      manifestPath,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'verified',
          reportPath: result.reportPath,
          backupId: result.report.backupId,
          durationMs: result.report.durationMs,
          checks: result.report.checks,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Restore drill failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
