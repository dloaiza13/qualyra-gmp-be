import { ErrorCode } from '../../../common/errors/error-codes.js';
import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import type { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';
import type { MetricsService } from '../../observability/application/metrics.service.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { PhotoEvidenceCapacityPolicy } from './photo-evidence-capacity.policy.js';
import { PhotoEvidenceService } from './photo-evidence.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const subjectId = '33333333-3333-4333-8333-333333333333';

describe('PhotoEvidenceService', () => {
  it('stores scanned image bytes outside PostgreSQL and persists immutable metadata', async () => {
    const fixture = createFixture(0);

    const result = await fixture.service.upload(
      { tenantId, userId, sessionId: 'session', tokenVersion: 0 },
      { subjectType: 'DEVIATION', subjectId, caption: 'Leak location' },
      {
        originalname: 'camera.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      },
      { correlationId: 'correlation', ipAddress: '127.0.0.1' },
    );

    expect(result.subjectId).toBe(subjectId);
    expect(result.caption).toBe('Leak location');
    expect(fixture.storage.store).toHaveBeenCalledWith(
      expect.stringContaining(
        `${tenantId}/photo-evidence/deviation/${subjectId}/`,
      ),
      expect.any(Buffer),
      'image/jpeg',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    const createInput =
      fixture.transaction.photoEvidence.create.mock.calls[0]?.[0];
    expect(createInput?.data).toMatchObject({
      tenantId,
      subjectId,
      sizeBytes: 4,
      storageDriver: 'LOCAL',
    });
    expect(fixture.metrics.recordPhotoEvidenceUpload).toHaveBeenCalledWith(
      'success',
      4,
    );
  });

  it('removes the newly stored object when the tenant quota is exceeded', async () => {
    const fixture = createFixture(7);

    await expect(
      fixture.service.upload(
        { tenantId, userId, sessionId: 'session', tokenVersion: 0 },
        { subjectType: 'DEVIATION', subjectId },
        {
          originalname: 'camera.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
        },
        { correlationId: 'correlation' },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PhotoEvidenceQuotaExceeded });

    expect(fixture.transaction.photoEvidence.create).not.toHaveBeenCalled();
    expect(fixture.storage.remove).toHaveBeenCalledTimes(1);
    expect(fixture.metrics.recordPhotoEvidenceUpload).toHaveBeenCalledWith(
      'quota_exceeded',
    );
  });

  it('reports the quota selected for the current tenant plan', async () => {
    const fixture = createFixture(9, 'PROFESSIONAL');

    await expect(
      fixture.service.usage({
        tenantId,
        userId,
        sessionId: 'session',
        tokenVersion: 0,
      }),
    ).resolves.toMatchObject({
      plan: 'PROFESSIONAL',
      usedBytes: 9,
      quotaBytes: 32,
      photoCount: 1,
      capacityStatus: 'NORMAL',
    });
  });
});

function createFixture(
  usedBytes: number,
  plan: 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' = 'TRIAL',
) {
  const createdAt = new Date('2026-08-20T00:00:00.000Z');
  const transaction = {
    $queryRaw: jest.fn(() => Promise.resolve([{ locked: 1 }])),
    tenant: {
      findFirst: jest.fn(() => Promise.resolve({ plan })),
    },
    deviation: {
      findFirst: jest.fn(() => Promise.resolve({ id: subjectId })),
    },
    tenantPhotoEvidenceUsage: {
      findUnique: jest.fn(() =>
        Promise.resolve({ usedBytes: BigInt(usedBytes), photoCount: 1 }),
      ),
      create: jest.fn(
        ({ data }: { data: { usedBytes: bigint; photoCount: number } }) =>
          Promise.resolve(data),
      ),
    },
    photoEvidence: {
      findFirst: jest.fn((): Promise<{ id: string } | null> =>
        Promise.resolve(null),
      ),
      aggregate: jest.fn(() =>
        Promise.resolve({
          _sum: { sizeBytes: usedBytes },
          _count: { _all: usedBytes > 0 ? 1 : 0 },
        }),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Record<string, unknown> & {
            caption?: string | null;
            capturedAt?: Date | null;
          };
        }) =>
          Promise.resolve({
            ...data,
            id: '44444444-4444-4444-8444-444444444444',
            caption: data.caption ?? null,
            capturedAt: data.capturedAt ?? null,
            createdAt,
            uploadedBy: { id: userId, displayName: 'QA User' },
          }),
      ),
    },
    securityEvent: {
      create: jest.fn(() => Promise.resolve({ id: 'event' })),
    },
  };
  const tenantUnitOfWork = {
    execute: jest.fn(
      (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
        work(transaction),
    ),
  };
  const storage = {
    store: jest.fn((objectKey: string) =>
      Promise.resolve({ objectKey, storageDriver: 'LOCAL' }),
    ),
    remove: jest.fn(() => Promise.resolve()),
  };
  const scanner = {
    scan: jest.fn(() =>
      Promise.resolve({ engine: 'TEST_SCANNER', result: 'SAFE' }),
    ),
  };
  const metrics = { recordPhotoEvidenceUpload: jest.fn() };
  const capacityPolicy = {
    quotaFor: jest.fn(() => {
      const quotas = {
        TRIAL: 8,
        STARTER: 16,
        PROFESSIONAL: 32,
        ENTERPRISE: 64,
      };
      return quotas[plan];
    }),
    statusFor: jest.fn((used: number, quota: number) =>
      used > quota
        ? 'OVER_QUOTA'
        : used / quota >= 0.95
          ? 'CRITICAL'
          : 'NORMAL',
    ),
  };
  const config = {
    getOrThrow: jest.fn((key: keyof Environment) => {
      const values: Partial<Record<keyof Environment, number>> = {
        PHOTO_EVIDENCE_MAX_BYTES: 1024,
        PHOTO_EVIDENCE_TENANT_QUOTA_BYTES: 8,
        PHOTO_EVIDENCE_STARTER_QUOTA_BYTES: 16,
        PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES: 32,
        PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES: 64,
      };
      return values[key] ?? 8;
    }),
  };

  return {
    transaction,
    storage,
    metrics,
    service: new PhotoEvidenceService(
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      storage as unknown as CapaEvidenceStorage,
      scanner as unknown as CapaEvidenceScanner,
      metrics as unknown as MetricsService,
      config as unknown as ConfigService<Environment, true>,
      capacityPolicy as unknown as PhotoEvidenceCapacityPolicy,
    ),
  };
}
