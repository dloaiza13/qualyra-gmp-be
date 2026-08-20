import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../src/common/config/environment.js';
import { S3CapaEvidenceStorage } from '../src/modules/capas/infrastructure/s3-capa-evidence-storage.js';

const values = {
  CAPA_EVIDENCE_S3_ENDPOINT:
    process.env.CAPA_EVIDENCE_S3_ENDPOINT ?? 'http://localhost:9000',
  CAPA_EVIDENCE_S3_REGION: process.env.CAPA_EVIDENCE_S3_REGION ?? 'us-east-1',
  CAPA_EVIDENCE_S3_BUCKET:
    process.env.CAPA_EVIDENCE_S3_BUCKET ?? 'qualyra-capa-evidence',
  CAPA_EVIDENCE_S3_ACCESS_KEY:
    process.env.CAPA_EVIDENCE_S3_ACCESS_KEY ?? 'qualyra',
  CAPA_EVIDENCE_S3_SECRET_KEY:
    process.env.CAPA_EVIDENCE_S3_SECRET_KEY ?? 'qualyra_dev_change_me',
  CAPA_EVIDENCE_S3_FORCE_PATH_STYLE:
    process.env.CAPA_EVIDENCE_S3_FORCE_PATH_STYLE !== 'false',
  CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET:
    process.env.CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET !== 'false',
};
const storage = new S3CapaEvidenceStorage(
  new ConfigService(values) as unknown as ConfigService<Environment, true>,
);
const objectKey = `operations/s3-drill/${randomUUID()}`;
const bytes = Buffer.from(`qualyra-s3-drill:${randomUUID()}`, 'utf8');
const sha256 = createHash('sha256').update(bytes).digest('hex');
let stored = false;

try {
  await storage.checkHealth();
  const result = await storage.store(
    objectKey,
    bytes,
    'application/octet-stream',
    sha256,
  );
  stored = true;
  const restored = await storage.read(objectKey);
  const restoredSha256 = createHash('sha256').update(restored).digest('hex');
  if (result.storageDriver !== 'S3' || restoredSha256 !== sha256) {
    throw new Error('S3 evidence integrity verification failed.');
  }
  await storage.remove(objectKey);
  stored = false;
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'verified',
        driver: result.storageDriver,
        endpoint: values.CAPA_EVIDENCE_S3_ENDPOINT,
        bucket: values.CAPA_EVIDENCE_S3_BUCKET,
        bytes: restored.length,
        sha256: restoredSha256,
        cleanup: 'object removed',
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (stored) await storage.remove(objectKey);
}
