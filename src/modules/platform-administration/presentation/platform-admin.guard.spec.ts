import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { Environment } from '../../../common/config/environment.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

describe('PlatformAdminGuard', () => {
  const token = 'platform-test-token-with-at-least-32-characters';

  it('accepts only the dedicated bearer token when the surface is enabled', () => {
    const guard = new PlatformAdminGuard(config(true));

    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
    expectGuardError(
      () => guard.canActivate(context('Bearer wrong')),
      ErrorCode.Unauthorized,
    );
  });

  it('conceals the route when platform administration is disabled', () => {
    const guard = new PlatformAdminGuard(config(false));

    expectGuardError(
      () => guard.canActivate(context(`Bearer ${token}`)),
      ErrorCode.NotFound,
    );
  });

  function expectGuardError(action: () => unknown, code: string) {
    try {
      action();
      throw new Error('Expected guard to reject the request');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code });
    }
  }

  function config(enabled: boolean) {
    return {
      getOrThrow: jest.fn((key: keyof Environment) =>
        key === 'PLATFORM_ADMIN_ENABLED' ? enabled : token,
      ),
    } as unknown as ConfigService<Environment, true>;
  }

  function context(authorization: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          header: (name: string) =>
            name === 'authorization' ? authorization : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }
});
