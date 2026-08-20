import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { PlatformTenantsService } from './platform-tenants.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('PlatformTenantsService', () => {
  it('changes commercial state atomically, revokes access, and appends an audit event', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    const current = {
      id: tenantId,
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
      plan: 'TRIAL',
      createdAt,
      updatedAt,
    } as const;
    const saved = {
      ...current,
      status: 'SUSPENDED',
      plan: 'PROFESSIONAL',
      updatedAt: new Date('2026-08-20T01:00:00.000Z'),
    } as const;
    const createAuditEvent = jest.fn<
      (args: {
        data: {
          operatorId: string;
          eventType: string;
          outcome: string;
          metadata: {
            revokedSessions: number;
            revokedRefreshTokens: number;
          };
        };
      }) => Promise<{ id: string }>
    >(() => Promise.resolve({ id: 'audit' }));
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: tenantId }])),
      tenant: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(() => Promise.resolve(saved)),
      },
      tenantPhotoEvidenceUsage: {
        findUnique: jest.fn(() =>
          Promise.resolve({ usedBytes: 1024n, photoCount: 1 }),
        ),
      },
      photoEvidence: { aggregate: jest.fn() },
      session: { updateMany: jest.fn(() => Promise.resolve({ count: 2 })) },
      refreshToken: {
        updateMany: jest.fn(() => Promise.resolve({ count: 3 })),
      },
      platformAuditEvent: {
        create: createAuditEvent,
      },
      user: {
        groupBy: jest.fn(() =>
          Promise.resolve([{ status: 'ACTIVE', _count: { _all: 4 } }]),
        ),
      },
    };
    const prisma = {
      tenant: { findUnique: jest.fn(() => Promise.resolve(saved)) },
    };
    const tenantUnitOfWork = {
      execute: jest.fn(
        (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const capacityPolicy = {
      quotaFor: jest.fn(() => 10_000),
      statusFor: jest.fn(() => 'NORMAL'),
    };
    const service = new PlatformTenantsService(
      prisma as unknown as PrismaService,
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      capacityPolicy as unknown as PhotoEvidenceCapacityPolicy,
      {
        getOrThrow: jest.fn(() => 'operator-test'),
      } as unknown as ConfigService<Environment, true>,
    );

    await expect(
      service.update(
        tenantId,
        {
          plan: 'PROFESSIONAL',
          status: 'SUSPENDED',
          reason: 'Customer requested a temporary commercial suspension.',
          acknowledgeOverQuota: false,
          expectedUpdatedAt: updatedAt.toISOString(),
        },
        { correlationId: '22222222-2222-4222-8222-222222222222' },
      ),
    ).resolves.toMatchObject({
      id: tenantId,
      plan: 'PROFESSIONAL',
      status: 'SUSPENDED',
      users: { active: 4 },
    });
    expect(transaction.session.updateMany).toHaveBeenCalled();
    expect(transaction.refreshToken.updateMany).toHaveBeenCalled();
    expect(createAuditEvent.mock.calls[0]?.[0]).toMatchObject({
      data: {
        operatorId: 'operator-test',
        eventType: 'PLATFORM_TENANT_COMMERCIAL_STATE_CHANGED',
        outcome: 'SUCCESS',
        metadata: {
          revokedSessions: 2,
          revokedRefreshTokens: 3,
        },
      },
    });
  });
});
