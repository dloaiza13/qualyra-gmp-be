import { createServer, type Server } from 'node:net';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { BuiltInCapaEvidenceScanner } from './built-in-capa-evidence-scanner.js';
import { ClamAvCapaEvidenceScanner } from './clamav-capa-evidence-scanner.js';

describe('ClamAvCapaEvidenceScanner', () => {
  let server: Server;
  let port: number;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    ['stream: OK\0', true],
    ['stream: Test.Signature FOUND\0', false],
  ])('interprets a clamd INSTREAM result', async (result, safe) => {
    await listen(result);
    const scanner = createScanner(port);
    const operation = scanner.scan({
      fileName: 'evidence.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7\ncontent\n%%EOF'),
    });
    if (safe) {
      await expect(operation).resolves.toMatchObject({
        engine: 'CLAMAV_INSTREAM',
        result: 'stream: OK',
      });
    } else {
      await expect(operation).rejects.toThrow(/antivirus scan/);
    }
  });

  it('fails closed when clamd is unavailable', async () => {
    await listen('stream: OK\0');
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await expect(
      createScanner(port).scan({
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.7\ncontent\n%%EOF'),
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it('requires an explicit PONG readiness response', async () => {
    await listen('PONG\0');
    await expect(createScanner(port).checkHealth()).resolves.toBeUndefined();
  });

  async function listen(result: string): Promise<void> {
    server = createServer((socket) => {
      socket.on('data', () => undefined);
      socket.on('end', () => socket.end(result));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No TCP port.');
    port = address.port;
  }
});

function createScanner(port: number): ClamAvCapaEvidenceScanner {
  const config = new ConfigService<Environment, true>({
    CAPA_EVIDENCE_MAX_BYTES: 1024 * 1024,
    CAPA_EVIDENCE_CLAMAV_HOST: '127.0.0.1',
    CAPA_EVIDENCE_CLAMAV_PORT: port,
    CAPA_EVIDENCE_CLAMAV_TIMEOUT_MS: 2_000,
  });
  return new ClamAvCapaEvidenceScanner(
    new BuiltInCapaEvidenceScanner(config),
    config,
  );
}
