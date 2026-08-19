import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';
import type { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import type { RedisService } from '../../../infrastructure/redis/redis.service.js';

describe('HealthService', () => {
  it('reports the process as live', () => {
    const prisma = {} as PrismaService;
    const service = createService(prisma);

    expect(service.getLiveness()).toMatchObject({ status: 'up' });
  });

  it('does not expose database errors in readiness responses', async () => {
    const prisma = {
      $queryRaw: () => Promise.reject(new Error('sensitive database error')),
    } as unknown as PrismaService;
    const service = createService(prisma);

    await expect(service.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports all critical dependencies without exposing implementation details', async () => {
    const prisma = {
      $queryRaw: () => Promise.resolve([{ value: 1 }]),
    } as unknown as PrismaService;

    await expect(createService(prisma).getReadiness()).resolves.toMatchObject({
      status: 'up',
      checks: [
        { name: 'database', status: 'up' },
        { name: 'redis', status: 'up' },
        { name: 'evidenceStorage', status: 'up' },
        { name: 'malwareScanner', status: 'up' },
      ],
    });
  });
});

function createService(prisma: PrismaService): HealthService {
  const healthyStorage = {
    checkHealth: () => Promise.resolve(),
  } as CapaEvidenceStorage;
  const healthyScanner = {
    checkHealth: () => Promise.resolve(),
  } as CapaEvidenceScanner;
  const redis = {
    ping: () => Promise.resolve(),
  } as RedisService;
  const config = new ConfigService<Environment, true>({
    OPERATIONAL_READINESS_TIMEOUT_MS: 500,
  });
  return new HealthService(
    prisma,
    healthyStorage,
    healthyScanner,
    redis,
    config,
  );
}
