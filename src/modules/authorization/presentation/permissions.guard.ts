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
import {
  CommercialEntitlementPolicy,
  commercialRestrictionError,
} from '../../commercial-entitlements/application/commercial-entitlement.policy.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { requiredPermissionsKey } from './permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly commercialEntitlements: CommercialEntitlementPolicy,
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

    const authorization = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const [user, session, tenant] = await Promise.all([
          transaction.user.findFirst({
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
                        select: {
                          permission: { select: { code: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
          transaction.session.findFirst({
            where: {
              id: principal.sessionId,
              tenantId: principal.tenantId,
              userId: principal.userId,
              status: 'ACTIVE',
              expiresAt: { gt: now },
            },
            select: { id: true },
          }),
          transaction.tenant.findFirst({
            where: { id: principal.tenantId },
            select: {
              plan: true,
              trialEndsAt: true,
              subscription: {
                select: {
                  status: true,
                  currentPeriodEndsAt: true,
                  graceEndsAt: true,
                },
              },
            },
          }),
        ]);
        if (!user || !session || !tenant) return undefined;
        const rawPermissions = new Set(
          user.userRoles.flatMap(({ role }) =>
            role.rolePermissions.map(({ permission }) => permission.code),
          ),
        );
        return {
          rawPermissions,
          effectivePermissions:
            this.commercialEntitlements.effectivePermissions(
              rawPermissions,
              tenant,
              now,
            ),
          tenant,
          evaluatedAt: now,
        };
      },
    );

    if (!authorization) throw unauthorized();
    if (
      !required.every((permission) =>
        authorization.effectivePermissions.has(permission),
      )
    ) {
      const restriction = this.commercialEntitlements.restrictionFor(
        required,
        authorization.rawPermissions,
        authorization.tenant,
        authorization.evaluatedAt,
      );
      throw commercialRestrictionError(
        restriction ?? 'ROLE',
        authorization.tenant,
        required,
      );
    }
    request.permissions = [...authorization.effectivePermissions].sort();
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
