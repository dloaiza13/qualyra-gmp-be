import { spawnSync } from 'node:child_process';

const confirmationFlag = '--confirm-data-loss';

if (!process.argv.includes(confirmationFlag)) {
  process.stderr.write(
    [
      'WARNING: infra:reset permanently deletes local PostgreSQL, Redis, MinIO, and ClamAV volumes.',
      `To confirm, run: npm run infra:reset -- ${confirmationFlag}`,
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(
    'docker',
    ['compose', 'down', '--volumes', '--remove-orphans'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}
