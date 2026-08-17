import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { LocalCapaEvidenceStorage } from './local-capa-evidence-storage.js';

describe('LocalCapaEvidenceStorage', () => {
  let root: string;
  let storage: LocalCapaEvidenceStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'qualyra-evidence-'));
    storage = new LocalCapaEvidenceStorage(
      new ConfigService<Environment, true>({
        CAPA_EVIDENCE_STORAGE_ROOT: root,
        CAPA_EVIDENCE_MAX_BYTES: 1024 * 1024,
      }),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores and revalidates an allowed file by SHA-256', async () => {
    const bytes = Buffer.from('%PDF-1.7\nControlled evidence\n%%EOF');
    const managed = await storage.store(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      {
        originalName: '../implementation.pdf',
        contentType: 'application/pdf',
        bytes,
      },
    );

    expect(managed).toMatchObject({
      fileName: 'implementation.pdf',
      contentType: 'application/pdf',
      scanResult: 'SAFE_SIGNATURE_AND_TYPE_VALIDATED',
    });
    expect(managed.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      storage.read(managed.objectKey, managed.sha256),
    ).resolves.toEqual(bytes);
  });

  it('rejects a mismatched signature and dangerous extensions', async () => {
    await expect(
      storage.store('tenant', 'capa', 'action', {
        originalName: 'not-an-image.png',
        contentType: 'image/png',
        bytes: Buffer.from('plain text'),
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      storage.store('tenant', 'capa', 'action', {
        originalName: 'script.js',
        contentType: 'text/plain',
        bytes: Buffer.from('alert(1)'),
      }),
    ).rejects.toThrow(/extension is not allowed/);
  });
});
