import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { requiredPermissionsKey } from './permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      requiredPermissionsKey,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & RequestWithContext>();
    const principal = request.principal;
    if (!principal) throw unauthorized();

    const granted = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const user = await transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: {
            userRoles: {
              select: {
                role: {
                  select: {
                    rolePermissions: {
                      select: { permission: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        });
        const session = await transaction.session.findFirst({
          where: {
            id: principal.sessionId,
            tenantId: principal.tenantId,
            userId: principal.userId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (!user || !session) return undefined;
        return new Set(
          user.userRoles.flatMap(({ role }) =>
            role.rolePermissions.map(({ permission }) => permission.code),
          ),
        );
      },
    );

    if (!granted) throw unauthorized();
    if (!required.every((permission) => granted.has(permission))) {
      throw new ApplicationError(
        ErrorCode.Forbidden,
        'The operation is forbidden.',
        HttpStatus.FORBIDDEN,
      );
    }
    request.permissions = [...granted].sort();
    return true;
  }
}

function unauthorized(): ApplicationError {
  return new ApplicationError(
    ErrorCode.Unauthorized,
    'Authentication is required.',
    HttpStatus.UNAUTHORIZED,
  );
}
