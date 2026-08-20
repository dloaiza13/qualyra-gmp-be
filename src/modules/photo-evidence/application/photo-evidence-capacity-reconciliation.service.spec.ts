import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { MetricsService } from '../../observability/application/metrics.service.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { PhotoEvidenceCapacityPolicy } from './photo-evidence-capacity.policy.js';
import { PhotoEvidenceCapacityReconciliationService } from './photo-evidence-capacity-reconciliation.service.js';

describe('PhotoEvidenceCapacityReconciliationService', () => {
  it('detects but does not overwrite a mismatch in an existing counter', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const update = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ locked: 1 }])),
      tenant: {
        findFirstOrThrow: jest.fn(() => Promise.resolve({ plan: 'TRIAL' })),
      },
      photoEvidence: {
        aggregate: jest.fn(() =>
          Promise.resolve({
            _sum: { sizeBytes: 1024 },
            _count: { _all: 1 },
          }),
        ),
      },
      tenantPhotoEvidenceUsage: {
        findUnique: jest.fn(() =>
          Promise.resolve({ usedBytes: 512n, photoCount: 1 }),
        ),
        create: jest.fn(),
        update,
      },
    };
    const prisma = {
      tenant: {
        findMany: jest.fn(() => Promise.resolve([{ id: tenantId }])),
      },
    };
    const tenantUnitOfWork = {
      execute: jest.fn(
        (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const capacityPolicy = {
      quotaFor: jest.fn(() => 2048),
      statusFor: jest.fn(() => 'NORMAL'),
    };
    const metrics = {
      updatePhotoEvidenceCapacity: jest.fn(),
      recordPhotoEvidenceReconciliation: jest.fn(),
    };
    const config = {
      getOrThrow: jest.fn((key: keyof Environment) =>
        key === 'PHOTO_EVIDENCE_RECONCILIATION_INTERVAL_MINUTES'
          ? 60
          : key === 'NODE_ENV'
            ? 'test'
            : true,
      ),
    };
    const service = new PhotoEvidenceCapacityReconciliationService(
      prisma as unknown as PrismaService,
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      capacityPolicy as unknown as PhotoEvidenceCapacityPolicy,
      metrics as unknown as MetricsService,
      config as unknown as ConfigService<Environment, true>,
    );

    await expect(service.run()).resolves.toMatchObject({
      tenantsChecked: 1,
      tenantsFailed: 0,
      mismatches: 1,
      capacity: { NORMAL: 1 },
    });
    expect(transaction.tenantPhotoEvidenceUsage.create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(metrics.updatePhotoEvidenceCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ mismatches: 1 }),
    );
  });
});
