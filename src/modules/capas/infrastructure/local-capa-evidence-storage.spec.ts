import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { BuiltInCapaEvidenceScanner } from './built-in-capa-evidence-scanner.js';
import { LocalCapaEvidenceStorage } from './local-capa-evidence-storage.js';

describe('managed CAPA evidence local pipeline', () => {
  let root: string;
  let storage: LocalCapaEvidenceStorage;
  let scanner: BuiltInCapaEvidenceScanner;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'qualyra-evidence-'));
    const config = new ConfigService<Environment, true>({
      CAPA_EVIDENCE_STORAGE_ROOT: root,
      CAPA_EVIDENCE_MAX_BYTES: 1024 * 1024,
    });
    storage = new LocalCapaEvidenceStorage(config);
    scanner = new BuiltInCapaEvidenceScanner(config);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('validates, stores, reads, and removes an allowed file', async () => {
    const bytes = Buffer.from('%PDF-1.7\nControlled evidence\n%%EOF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await expect(
      scanner.scan({
        fileName: 'implementation.pdf',
        contentType: 'application/pdf',
        bytes,
      }),
    ).resolves.toEqual({
      engine: 'QUALYRA_BUILT_IN_V1',
      result: 'SAFE_SIGNATURE_AND_TYPE_VALIDATED',
    });
    await expect(
      storage.store(
        'tenant/capa/action/object',
        bytes,
        'application/pdf',
        sha256,
      ),
    ).resolves.toMatchObject({ storageDriver: 'LOCAL' });
    await expect(storage.read('tenant/capa/action/object')).resolves.toEqual(
      bytes,
    );
    await storage.remove('tenant/capa/action/object');
    await expect(storage.read('tenant/capa/action/object')).rejects.toThrow();
  });

  it('rejects a mismatched signature and dangerous extensions', async () => {
    await expect(
      scanner.scan({
        fileName: 'not-an-image.png',
        contentType: 'image/png',
        bytes: Buffer.from('plain text'),
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      scanner.scan({
        fileName: 'script.js',
        contentType: 'text/plain',
        bytes: Buffer.from('alert(1)'),
      }),
    ).rejects.toThrow(/extension is not allowed/);
  });
});
