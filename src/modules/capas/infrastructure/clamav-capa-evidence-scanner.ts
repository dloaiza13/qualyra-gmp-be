import { createConnection, type Socket } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import {
  CapaEvidenceScanner,
  type EvidenceScanInput,
  type EvidenceScanResult,
} from '../domain/ports/capa-evidence-scanner.js';
import { BuiltInCapaEvidenceScanner } from './built-in-capa-evidence-scanner.js';

@Injectable()
export class ClamAvCapaEvidenceScanner extends CapaEvidenceScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly builtIn: BuiltInCapaEvidenceScanner,
    config: ConfigService<Environment, true>,
  ) {
    super();
    this.host = config.getOrThrow('CAPA_EVIDENCE_CLAMAV_HOST', { infer: true });
    this.port = config.getOrThrow('CAPA_EVIDENCE_CLAMAV_PORT', { infer: true });
    this.timeoutMs = config.getOrThrow('CAPA_EVIDENCE_CLAMAV_TIMEOUT_MS', {
      infer: true,
    });
  }

  async checkHealth(): Promise<void> {
    const response = await sendClamCommand(
      'zPING\0',
      this.host,
      this.port,
      this.timeoutMs,
    );
    if (response !== 'PONG') {
      throw new Error('The antivirus scanner readiness check failed.');
    }
  }

  async scan(input: EvidenceScanInput): Promise<EvidenceScanResult> {
    await this.builtIn.scan(input);
    const response = await scanStream(
      input.bytes,
      this.host,
      this.port,
      this.timeoutMs,
    );
    if (response.endsWith(': OK')) {
      return { engine: 'CLAMAV_INSTREAM', result: response };
    }
    if (response.endsWith(' FOUND')) {
      throw new Error('The evidence file was rejected by the antivirus scan.');
    }
    throw new Error(
      `The antivirus scanner returned an invalid result: ${response}`,
    );
  }
}

function sendClamCommand(
  command: string,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const response: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result ?? '');
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () =>
      finish(new Error('The antivirus scanner readiness check timed out.')),
    );
    socket.on('error', () =>
      finish(new Error('The antivirus scanner is unavailable.')),
    );
    socket.on('data', (chunk: Buffer) => response.push(chunk));
    socket.on('end', () =>
      finish(
        undefined,
        Buffer.concat(response).toString('utf8').replace(/\0+$/, '').trim(),
      ),
    );
    socket.on('connect', () => socket.end(command));
  });
}

function scanStream(
  bytes: Buffer,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const response: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result ?? '');
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () =>
      finish(new Error('The antivirus scanner timed out; upload denied.')),
    );
    socket.on('error', () =>
      finish(new Error('The antivirus scanner is unavailable; upload denied.')),
    );
    socket.on('data', (chunk: Buffer) => response.push(chunk));
    socket.on('end', () => {
      const result = Buffer.concat(response)
        .toString('utf8')
        .replace(/\0+$/, '')
        .trim();
      if (!result) {
        finish(
          new Error('The antivirus scanner returned no result; upload denied.'),
        );
      } else {
        finish(undefined, result);
      }
    });
    socket.on('connect', () => writeInstream(socket, bytes));
  });
}

function writeInstream(socket: Socket, bytes: Buffer): void {
  socket.write('zINSTREAM\0');
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(chunk.length);
    socket.write(length);
    socket.write(chunk);
  }
  socket.end(Buffer.alloc(4));
}
