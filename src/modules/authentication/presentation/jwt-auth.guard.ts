import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenService } from '../../../infrastructure/crypto/access-token.service.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { ErrorCodeValue } from '../../../common/errors/error-codes.js';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & RequestWithContext>();
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;

    if (!token) throw unauthorized();

    try {
      const principal = await this.accessTokens.verify(token);
      const valid = await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const user = await transaction.user.findFirst({
            where: {
              id: principal.userId,
              tenantId: principal.tenantId,
              status: 'ACTIVE',
            },
            select: { passwordChangedAt: true },
          });
          const session = await transaction.session.findFirst({
            where: {
              id: principal.sessionId,
              tenantId: principal.tenantId,
              userId: principal.userId,
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          });
          const tokenVersion = user?.passwordChangedAt?.getTime() ?? 0;
          return Boolean(
            user && session && tokenVersion === principal.tokenVersion,
          );
        },
      );

      if (!valid) throw unauthorized(ErrorCode.SessionRevoked);
      request.principal = principal;
      return true;
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw unauthorized();
    }
  }
}

function unauthorized(
  code: ErrorCodeValue = ErrorCode.Unauthorized,
): ApplicationError {
  return new ApplicationError(
    code,
    'Authentication is required.',
    HttpStatus.UNAUTHORIZED,
  );
}
