import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import {
  CapaEvidenceScanner,
  type EvidenceScanInput,
  type EvidenceScanResult,
} from '../domain/ports/capa-evidence-scanner.js';

@Injectable()
export class BuiltInCapaEvidenceScanner extends CapaEvidenceScanner {
  private readonly maxBytes: number;

  constructor(config: ConfigService<Environment, true>) {
    super();
    this.maxBytes = config.getOrThrow('CAPA_EVIDENCE_MAX_BYTES', {
      infer: true,
    });
  }

  checkHealth(): Promise<void> {
    return Promise.resolve();
  }

  async scan(input: EvidenceScanInput): Promise<EvidenceScanResult> {
    await Promise.resolve();
    validateEvidence(
      input.bytes,
      input.contentType,
      input.fileName,
      this.maxBytes,
    );
    return {
      engine: 'QUALYRA_BUILT_IN_V1',
      result: 'SAFE_SIGNATURE_AND_TYPE_VALIDATED',
    };
  }
}

export function validateEvidence(
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
    'image/webp': (content) =>
      content.length >= 12 &&
      content.subarray(0, 4).toString('ascii') === 'RIFF' &&
      content.subarray(8, 12).toString('ascii') === 'WEBP',
    'image/heic': (content) => isIsoBaseMediaImage(content),
    'image/heif': (content) => isIsoBaseMediaImage(content),
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

function isIsoBaseMediaImage(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    return false;
  }
  const brand = bytes.subarray(8, 12).toString('ascii');
  return new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']).has(brand);
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
