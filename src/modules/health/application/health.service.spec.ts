import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';

describe('HealthService', () => {
  it('reports the process as live', () => {
    const prisma = {} as PrismaService;
    const service = new HealthService(prisma);

    expect(service.getLiveness()).toMatchObject({ status: 'up' });
  });

  it('does not expose database errors in readiness responses', async () => {
    const prisma = {
      $queryRaw: () => Promise.reject(new Error('sensitive database error')),
    } as unknown as PrismaService;
    const service = new HealthService(prisma);

    await expect(service.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
