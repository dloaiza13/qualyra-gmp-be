import { jest } from '@jest/globals';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import type { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { ProfileService } from './profile.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const principal = {
  tenantId,
  userId,
  sessionId: 'session',
  tokenVersion: 0,
  effectivePermissions: [],
};
const request = { correlationId: 'correlation', ipAddress: '127.0.0.1' };

describe('ProfileService', () => {
  it('updates personal preferences and records a security event', async () => {
    const fixture = createFixture();

    const result = await fixture.service.update(
      principal,
      {
        displayName: '  Jane Reviewer  ',
        themePreference: 'DARK',
        localePreference: 'EN',
      },
      request,
    );

    expect(result).toEqual({
      displayName: 'Jane Reviewer',
      themePreference: 'DARK',
      localePreference: 'EN',
      avatarUpdatedAt: null,
    });
    expect(fixture.transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: {
          displayName: 'Jane Reviewer',
          themePreference: 'DARK',
          localePreference: 'EN',
        },
      }),
    );
    expect(
      fixture.transaction.securityEvent.create.mock.calls[0]?.[0].data
        .eventType,
    ).toBe('PROFILE_PREFERENCES_UPDATED');
  });

  it('rejects unsafe profile image formats before scanning or storage', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.uploadAvatar(
        principal,
        {
          originalname: 'avatar.svg',
          mimetype: 'image/svg+xml',
          buffer: Buffer.from('<svg/>'),
        },
        request,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ProfileInvalid });

    expect(fixture.scanner.scan).not.toHaveBeenCalled();
    expect(fixture.storage.store).not.toHaveBeenCalled();
  });

  it('stores a scanned avatar and removes the superseded object', async () => {
    const fixture = createFixture('old/avatar');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);

    const result = await fixture.service.uploadAvatar(
      principal,
      { originalname: 'avatar.jpg', mimetype: 'image/jpeg', buffer: bytes },
      request,
    );

    expect(result.avatarUpdatedAt).toBe('2026-08-24T12:00:00.000Z');
    expect(fixture.storage.store).toHaveBeenCalledWith(
      expect.stringContaining(`${tenantId}/profile-avatars/${userId}/`),
      bytes,
      'image/jpeg',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(fixture.storage.remove).toHaveBeenCalledWith('old/avatar');
    expect(
      fixture.transaction.securityEvent.create.mock.calls[0]?.[0].data
        .eventType,
    ).toBe('PROFILE_AVATAR_UPDATED');
  });
});

function createFixture(oldObjectKey: string | null = null) {
  const updatedAt = oldObjectKey ? new Date('2026-08-24T12:00:00.000Z') : null;
  const createSecurityEvent = jest.fn<
    (input: { data: { eventType: string } }) => Promise<{ id: string }>
  >(() => Promise.resolve({ id: 'event' }));
  const transaction = {
    user: {
      findFirstOrThrow: jest.fn(() =>
        Promise.resolve({ avatarObjectKey: oldObjectKey }),
      ),
      update: jest.fn((input: { data: { displayName?: string } }) =>
        Promise.resolve({
          displayName: input.data.displayName ?? 'Jane Administrator',
          themePreference: input.data.displayName ? 'DARK' : 'SYSTEM',
          localePreference: input.data.displayName ? 'EN' : 'ES',
          avatarUpdatedAt: updatedAt,
        }),
      ),
    },
    securityEvent: { create: createSecurityEvent },
  };
  const tenantUnitOfWork = {
    execute: jest.fn(
      (
        _tenantId: string,
        work: (client: typeof transaction) => Promise<unknown>,
      ) => work(transaction),
    ),
  };
  const storage = {
    store: jest.fn(() =>
      Promise.resolve({ objectKey: 'new/avatar', storageDriver: 'LOCAL' }),
    ),
    read: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
    remove: jest.fn(() => Promise.resolve()),
  };
  const scanner = {
    scan: jest.fn(() =>
      Promise.resolve({ engine: 'built-in', result: 'CLEAN' }),
    ),
  };
  return {
    transaction,
    tenantUnitOfWork,
    storage,
    scanner,
    service: new ProfileService(
      tenantUnitOfWork as unknown as TenantUnitOfWork,
      storage as unknown as CapaEvidenceStorage,
      scanner as unknown as CapaEvidenceScanner,
    ),
  };
}
