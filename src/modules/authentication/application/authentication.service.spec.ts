import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import type { AccessTokenService } from '../../../infrastructure/crypto/access-token.service.js';
import type { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { SecureTokenService } from '../../../infrastructure/crypto/secure-token.service.js';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { NotificationOutboxService } from '../../notifications/application/notification-outbox.service.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { CommercialEntitlementPolicy } from '../../commercial-entitlements/application/commercial-entitlement.policy.js';
import { AuthenticationService } from './authentication.service.js';

describe('AuthenticationService platform provisioning', () => {
  it('creates the access baseline without a session and sends a one-time password setup link', async () => {
    const setupTokenId = '22222222-2222-4222-8222-222222222222';
    const createTenant = jest.fn<
      (input: { data: { plan?: string } }) => Promise<void>
    >(() => Promise.resolve());
    const createPasswordResetToken = jest.fn<
      (input: { data: { id: string; tokenHash: string } }) => Promise<void>
    >(() => Promise.resolve());
    const createPlatformAuditEvent = jest.fn<
      (input: {
        data: { eventType: string; operatorId: string };
      }) => Promise<void>
    >(() => Promise.resolve());
    const transaction = {
      tenant: { create: createTenant },
      permission: {
        findMany: jest.fn(() =>
          Promise.resolve([{ id: 'permission-1', code: 'users.read' }]),
        ),
      },
      role: {
        create: jest.fn((input: { data: { name: string } }) =>
          Promise.resolve({ id: `role-${input.data.name}` }),
        ),
      },
      rolePermission: { createMany: jest.fn(() => Promise.resolve()) },
      user: { create: jest.fn(() => Promise.resolve()) },
      userRole: { create: jest.fn(() => Promise.resolve()) },
      passwordResetToken: { create: createPasswordResetToken },
      securityEvent: { create: jest.fn(() => Promise.resolve()) },
      platformAuditEvent: { create: createPlatformAuditEvent },
    };
    const tenantUnitOfWork = {
      execute: jest.fn(
        (_id: string, work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const passwordHasher = {
      hash: jest.fn(() => Promise.resolve('argon2-hash')),
    };
    const tokens = {
      create: jest
        .fn()
        .mockReturnValueOnce({
          id: 'initial-secret',
          raw: 'generated-secret-never-returned',
          hash: 'initial-secret-hash',
        })
        .mockReturnValueOnce({
          id: setupTokenId,
          raw: 'one-time-password-setup-token',
          hash: 'setup-token-hash',
        }),
    };
    const enqueue = jest.fn<
      (client: unknown, input: { type: string }) => Promise<void>
    >(() => Promise.resolve());
    const outbox = {
      enqueue,
      deliverTenant: jest.fn(() => Promise.resolve()),
    };
    const service = new AuthenticationService(
      {} as PrismaService,
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      passwordHasher as unknown as PasswordHasher,
      tokens as unknown as SecureTokenService,
      {} as AccessTokenService,
      outbox as unknown as NotificationOutboxService,
      new CommercialEntitlementPolicy(),
      {
        getOrThrow: jest.fn((key: keyof Environment) => {
          if (key === 'REFRESH_TOKEN_TTL_DAYS') return 30;
          if (key === 'PASSWORD_RESET_TTL_MINUTES') return 30;
          if (key === 'EMAIL_VERIFICATION_TTL_HOURS') return 24;
          return false;
        }),
      } as unknown as ConfigService<Environment, true>,
    );

    const result = await service.provisionCompany(
      {
        tenantName: 'Acme Pharma',
        tenantSlug: 'acme-pharma',
        adminName: 'Jane Admin',
        email: 'jane@acme.test',
        plan: 'PROFESSIONAL',
        reason: 'Approved commercial order Q-2026-0088.',
        operatorId: 'commercial-operations',
      },
      { correlationId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(result.tenantId).toEqual(expect.any(String));

    expect(createTenant.mock.calls[0]?.[0]).toMatchObject({
      data: { plan: 'PROFESSIONAL' },
    });
    expect(passwordHasher.hash).toHaveBeenCalledWith(
      'generated-secret-never-returned',
    );
    expect(transaction).not.toHaveProperty('session');
    expect(createPasswordResetToken.mock.calls[0]?.[0]).toMatchObject({
      data: {
        id: setupTokenId,
        tokenHash: 'setup-token-hash',
      },
    });
    expect(enqueue.mock.calls[0]?.[0]).toBe(transaction);
    expect(enqueue.mock.calls[0]?.[1]).toMatchObject({
      type: 'AUTH_PASSWORD_RESET',
    });
    expect(createPlatformAuditEvent.mock.calls[0]?.[0]).toMatchObject({
      data: {
        eventType: 'PLATFORM_TENANT_PROVISIONED',
        operatorId: 'commercial-operations',
      },
    });
    expect(outbox.deliverTenant).toHaveBeenCalledWith(result.tenantId);
  });
});
