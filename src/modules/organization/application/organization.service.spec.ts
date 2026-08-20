import { jest } from '@jest/globals';
import type { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { OrganizationService } from './organization.service.js';

describe('OrganizationService', () => {
  it('returns only the authenticated tenant commercial summary', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const transaction = {
      tenant: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: tenantId,
            name: 'Acme',
            slug: 'acme',
            status: 'ACTIVE',
            plan: 'STARTER',
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
          }),
        ),
      },
      user: {
        count: jest
          .fn<() => Promise<number>>()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(4),
      },
      invitation: { count: jest.fn(() => Promise.resolve(1)) },
      tenantPhotoEvidenceUsage: {
        findUnique: jest.fn(() =>
          Promise.resolve({ usedBytes: 1024n, photoCount: 2 }),
        ),
      },
      photoEvidence: { aggregate: jest.fn() },
    };
    const tenantUnitOfWork = {
      execute: jest.fn(
        (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new OrganizationService(
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      {
        quotaFor: jest.fn(() => 10_240),
        statusFor: jest.fn(() => 'NORMAL'),
      } as unknown as PhotoEvidenceCapacityPolicy,
    );

    await expect(
      service.summary({
        tenantId,
        userId: '22222222-2222-4222-8222-222222222222',
        sessionId: '33333333-3333-4333-8333-333333333333',
        tokenVersion: 0,
      }),
    ).resolves.toMatchObject({
      id: tenantId,
      plan: 'STARTER',
      users: { active: 3, total: 4, pendingInvitations: 1 },
      photographicEvidence: {
        usedBytes: 1024,
        quotaBytes: 10_240,
        photoCount: 2,
        usagePercent: 10,
      },
      membership: 'INVITATION_ONLY',
      commercialManagement: 'PROVIDER_MANAGED',
    });
    expect(tenantUnitOfWork.execute).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
    );
  });
});
