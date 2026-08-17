import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';

export interface ManagedEvidenceFile {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  scanEngine: string;
  scanResult: string;
}

export interface EvidenceUploadInput {
  originalName: string;
  contentType: string;
  bytes: Buffer;
}

@Injectable()
export class LocalCapaEvidenceStorage {
  private readonly root: string;
  readonly maxBytes: number;

  constructor(config: ConfigService<Environment, true>) {
    this.root = resolve(
      config.getOrThrow('CAPA_EVIDENCE_STORAGE_ROOT', { infer: true }),
    );
    this.maxBytes = config.getOrThrow('CAPA_EVIDENCE_MAX_BYTES', {
      infer: true,
    });
  }

  async store(
    tenantId: string,
    capaId: string,
    actionId: string,
    input: EvidenceUploadInput,
  ): Promise<ManagedEvidenceFile> {
    const fileName = safeFileName(input.originalName);
    validateEvidence(input.bytes, input.contentType, fileName, this.maxBytes);
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const objectKey = [tenantId, capaId, actionId, randomUUID()].join('/');
    const path = this.resolveObject(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes, { flag: 'wx' });
    return {
      fileName,
      contentType: input.contentType,
      sizeBytes: input.bytes.length,
      sha256,
      objectKey,
      scanEngine: 'QUALYRA_BUILT_IN_V1',
      scanResult: 'SAFE_SIGNATURE_AND_TYPE_VALIDATED',
    };
  }

  async read(objectKey: string, expectedSha256: string): Promise<Buffer> {
    const bytes = await readFile(this.resolveObject(objectKey));
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error('Managed evidence integrity verification failed.');
    }
    return bytes;
  }

  async removeNewObject(objectKey: string): Promise<void> {
    await rm(this.resolveObject(objectKey), { force: true });
  }

  private resolveObject(objectKey: string): string {
    const path = resolve(this.root, ...objectKey.split('/'));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid managed evidence object key.');
    }
    return path;
  }
}

function safeFileName(value: string): string {
  const fileName = basename(value.replaceAll('\\', '/'))
    .normalize('NFC')
    .trim();
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.length > 255
  ) {
    throw new Error('The evidence filename is invalid.');
  }
  return fileName;
}

function validateEvidence(
  bytes: Buffer,
  contentType: string,
  fileName: string,
  maxBytes: number,
): void {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(
      `Evidence files must contain between 1 and ${maxBytes} bytes.`,
    );
  }

  const dangerousExtension =
    /\.(?:bat|cmd|com|dll|exe|hta|html?|js|msi|ps1|scr|svg|vbs|zip)$/i;
  if (dangerousExtension.test(fileName)) {
    throw new Error('This evidence file extension is not allowed.');
  }

  const signatures: Record<string, (content: Buffer) => boolean> = {
    'application/pdf': (content) =>
      content.subarray(0, 5).toString('ascii') === '%PDF-',
    'image/png': (content) =>
      content
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': (content) =>
      content.length >= 3 &&
      content[0] === 0xff &&
      content[1] === 0xd8 &&
      content[2] === 0xff,
    'text/plain': (content) => isUtf8Text(content),
  };
  const matchesSignature = signatures[contentType];
  if (!matchesSignature || !matchesSignature(bytes)) {
    throw new Error(
      'The declared evidence type does not match an allowed file signature.',
    );
  }

  const executableMagic =
    bytes.subarray(0, 2).toString('ascii') === 'MZ' ||
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const knownTestSignature = [
    'X5O!P%@AP',
    '[4\\PZX54(P^)',
    '7CC)7}$EICAR',
  ].join('');
  if (
    executableMagic ||
    bytes.toString('latin1').includes(knownTestSignature)
  ) {
    throw new Error(
      'The evidence file was rejected by the built-in safety scan.',
    );
  }
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
