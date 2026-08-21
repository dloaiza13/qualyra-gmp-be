import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { PlatformTenantsService } from './platform-tenants.service.js';
import { CommercialEntitlementPolicy } from '../../commercial-entitlements/application/commercial-entitlement.policy.js';

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
      trialEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      createdAt,
      updatedAt,
    } as const;
    const saved = {
      ...current,
      status: 'SUSPENDED',
      plan: 'PROFESSIONAL',
      updatedAt: new Date('2026-08-20T01:00:00.000Z'),
    } as const;
    const subscription = {
      tenantId,
      status: 'TRIALING',
      billingInterval: 'NONE',
      provider: 'MANUAL',
      providerCustomerId: null,
      providerSubscriptionId: null,
      currentPeriodStartsAt: createdAt,
      currentPeriodEndsAt: current.trialEndsAt,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      lastProviderEventAt: null,
      lastProviderEventId: null,
      createdAt,
      updatedAt,
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
      tenantSubscription: {
        findUnique: jest.fn(() => Promise.resolve(subscription)),
        update: jest.fn(() =>
          Promise.resolve({
            ...subscription,
            status: 'ACTIVE',
            billingInterval: 'MONTHLY',
            updatedAt: new Date('2026-08-20T01:00:00.000Z'),
          }),
        ),
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
        count: jest.fn(() => Promise.resolve(4)),
        groupBy: jest.fn(() =>
          Promise.resolve([{ status: 'ACTIVE', _count: { _all: 4 } }]),
        ),
      },
      invitation: { count: jest.fn(() => Promise.resolve(0)) },
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
    const authentication = { provisionCompany: jest.fn() };
    const service = new PlatformTenantsService(
      prisma as unknown as PrismaService,
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      capacityPolicy as unknown as PhotoEvidenceCapacityPolicy,
      authentication as never,
      new CommercialEntitlementPolicy(),
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
          acknowledgeUserOverage: false,
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

  it('requires an explicit acknowledgement before a user-overage downgrade', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    const current = {
      id: tenantId,
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      trialEndsAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt,
    } as const;
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: tenantId }])),
      tenant: { findUnique: jest.fn(() => Promise.resolve(current)) },
      tenantPhotoEvidenceUsage: {
        findUnique: jest.fn(() =>
          Promise.resolve({ usedBytes: 1024n, photoCount: 1 }),
        ),
      },
      photoEvidence: { aggregate: jest.fn() },
      user: { count: jest.fn(() => Promise.resolve(11)) },
      invitation: { count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new PlatformTenantsService(
      {} as PrismaService,
      {
        execute: jest.fn(
          (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
      } as unknown as TenantUnitOfWork,
      {
        quotaFor: jest.fn(() => 10_000),
        statusFor: jest.fn(() => 'NORMAL'),
      } as unknown as PhotoEvidenceCapacityPolicy,
      { provisionCompany: jest.fn() } as never,
      new CommercialEntitlementPolicy(),
      {
        getOrThrow: jest.fn(() => 'operator-test'),
      } as unknown as ConfigService<Environment, true>,
    );

    await expect(
      service.update(
        tenantId,
        {
          plan: 'STARTER',
          reason: 'Customer requested a controlled Starter plan downgrade.',
          acknowledgeOverQuota: false,
          acknowledgeUserOverage: false,
          expectedUpdatedAt: updatedAt.toISOString(),
        },
        { correlationId: '22222222-2222-4222-8222-222222222222' },
      ),
    ).rejects.toMatchObject({
      code: 'PLATFORM_TENANT_CONFLICT',
      details: [{ committedUsers: 11, nextUserLimit: 10 }],
    });
  });

  it('extends the tenant trial when a normalized provider renewal is applied', async () => {
    const updatedAt = new Date('2026-08-20T00:00:00.000Z');
    const currentPeriodEndsAt = new Date('2026-09-01T00:00:00.000Z');
    const nextPeriodEndsAt = '2026-10-01T00:00:00.000Z';
    const subscription = {
      tenantId,
      status: 'TRIALING',
      billingInterval: 'NONE',
      provider: 'MANUAL',
      providerCustomerId: null,
      providerSubscriptionId: null,
      currentPeriodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEndsAt,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      lastProviderEventAt: null,
      lastProviderEventId: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt,
    } as const;
    const updateTenant = jest.fn(() => Promise.resolve());
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: tenantId }])),
      tenant: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: tenantId, plan: 'TRIAL' }),
        ),
        update: updateTenant,
      },
      tenantSubscription: {
        findUnique: jest.fn(() => Promise.resolve(subscription)),
        update: jest.fn((input: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...subscription,
            ...input.data,
            currentPeriodEndsAt: new Date(nextPeriodEndsAt),
            updatedAt: new Date('2026-08-20T01:00:00.000Z'),
          }),
        ),
      },
      billingProviderEvent: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() =>
          Promise.resolve({
            id: '33333333-3333-4333-8333-333333333333',
            status: 'PROCESSED',
          }),
        ),
      },
      platformAuditEvent: { create: jest.fn(() => Promise.resolve()) },
    };
    const service = new PlatformTenantsService(
      {} as PrismaService,
      {
        execute: jest.fn(
          (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
      } as unknown as TenantUnitOfWork,
      {} as PhotoEvidenceCapacityPolicy,
      { provisionCompany: jest.fn() } as never,
      new CommercialEntitlementPolicy(),
      {
        getOrThrow: jest.fn(() => 'operator-test'),
      } as unknown as ConfigService<Environment, true>,
    );

    await expect(
      service.processBillingProviderEvent(
        tenantId,
        {
          provider: 'test',
          providerEventId: 'renewal-1',
          eventType: 'SUBSCRIPTION_RENEWED',
          occurredAt: '2026-08-20T12:00:00.000Z',
          plan: 'TRIAL',
          currentPeriodEndsAt: nextPeriodEndsAt,
        },
        { correlationId: '22222222-2222-4222-8222-222222222222' },
      ),
    ).resolves.toMatchObject({ status: 'PROCESSED', duplicate: false });
    expect(updateTenant).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: {
        plan: 'TRIAL',
        trialEndsAt: new Date(nextPeriodEndsAt),
      },
    });
  });
});
