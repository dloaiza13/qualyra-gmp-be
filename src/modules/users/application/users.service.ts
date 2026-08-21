import { HttpStatus, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CommercialEntitlementPolicy } from '../../commercial-entitlements/application/commercial-entitlement.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  UpdateUserRolesDto,
  UpdateUserStatusDto,
} from './dto/user-request.dto.js';
import type { UserResponseDto } from './dto/user-response.dto.js';

const userWithRoles = {
  userRoles: {
    include: { role: true },
    orderBy: { role: { name: 'asc' } },
  },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRoles }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly commercialEntitlements: CommercialEntitlementPolicy,
  ) {}

  list(principal: AuthenticatedPrincipal): Promise<UserResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const users = await transaction.user.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
          include: userWithRoles,
        });
        return users.map(mapUser);
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    userId: string,
  ): Promise<UserResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const user = await transaction.user.findFirst({
          where: { id: userId, tenantId: principal.tenantId },
          include: userWithRoles,
        });
        if (!user) throw userNotFound();

        return mapUser(user);
      },
    );
  }

  updateStatus(
    principal: AuthenticatedPrincipal,
    userId: string,
    input: UpdateUserStatusDto,
    request: RequestMetadata,
  ): Promise<UserResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockTenant(transaction, principal.tenantId);
        const user = await transaction.user.findFirst({
          where: { id: userId, tenantId: principal.tenantId },
          include: userWithRoles,
        });
        if (!user) throw userNotFound();

        if (user.status === 'DISABLED' && input.status === 'ACTIVE') {
          const now = new Date();
          const [tenant, committedUsers, pendingInvitations] =
            await Promise.all([
              transaction.tenant.findUniqueOrThrow({
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
              transaction.user.count({
                where: {
                  tenantId: principal.tenantId,
                  status: { not: 'DISABLED' },
                },
              }),
              transaction.invitation.count({
                where: {
                  tenantId: principal.tenantId,
                  status: 'PENDING',
                  expiresAt: { gt: now },
                },
              }),
            ]);
          this.commercialEntitlements.assertCanAllocateSeat(
            tenant,
            committedUsers + pendingInvitations,
            { now },
          );
        }

        if (
          input.status === 'DISABLED' &&
          user.status !== 'DISABLED' &&
          hasAdministratorRole(user)
        ) {
          await assertAnotherActiveAdministrator(
            transaction,
            principal.tenantId,
            user.id,
          );
        }

        const now = new Date();
        const updated = await transaction.user.update({
          where: { id: user.id },
          data: {
            status: input.status,
            failedLoginCount: input.status === 'ACTIVE' ? 0 : undefined,
            lockedUntil: input.status === 'ACTIVE' ? null : undefined,
          },
          include: userWithRoles,
        });
        if (input.status === 'DISABLED') {
          await transaction.session.updateMany({
            where: {
              tenantId: principal.tenantId,
              userId: user.id,
              status: 'ACTIVE',
            },
            data: {
              status: 'REVOKED',
              revokedAt: now,
              revokeReason: 'USER_DISABLED',
            },
          });
          await transaction.refreshToken.updateMany({
            where: {
              tenantId: principal.tenantId,
              userId: user.id,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
        }
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: user.id,
          eventType:
            user.status === 'LOCKED' && input.status === 'ACTIVE'
              ? 'ACCOUNT_UNLOCKED'
              : 'USER_STATUS_CHANGED',
          outcome: 'SUCCESS',
          request,
          metadata: { previousStatus: user.status, newStatus: input.status },
        });
        return mapUser(updated);
      },
    );
  }

  updateRoles(
    principal: AuthenticatedPrincipal,
    userId: string,
    input: UpdateUserRolesDto,
    request: RequestMetadata,
  ): Promise<UserResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockTenant(transaction, principal.tenantId);
        const user = await transaction.user.findFirst({
          where: { id: userId, tenantId: principal.tenantId },
          include: userWithRoles,
        });
        if (!user) throw userNotFound();

        const roles = await transaction.role.findMany({
          where: { tenantId: principal.tenantId, id: { in: input.roleIds } },
          select: { id: true, name: true, isSystem: true },
        });
        if (roles.length !== input.roleIds.length) throw roleInvalid();

        const removesAdministrator =
          user.status === 'ACTIVE' &&
          hasAdministratorRole(user) &&
          !roles.some(
            ({ name, isSystem }) => isSystem && name === 'Administrator',
          );
        if (removesAdministrator) {
          await assertAnotherActiveAdministrator(
            transaction,
            principal.tenantId,
            user.id,
          );
        }

        const previousRoleIds = user.userRoles.map(({ roleId }) => roleId);
        await transaction.userRole.deleteMany({
          where: { tenantId: principal.tenantId, userId: user.id },
        });
        await transaction.userRole.createMany({
          data: roles.map(({ id: roleId }) => ({
            tenantId: principal.tenantId,
            userId: user.id,
            roleId,
          })),
        });
        const updated = await transaction.user.findUniqueOrThrow({
          where: { id: user.id },
          include: userWithRoles,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: user.id,
          eventType: 'USER_ROLES_CHANGED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            previousRoleIds,
            newRoleIds: roles.map(({ id }) => id),
          },
        });
        return mapUser(updated);
      },
    );
  }
}

async function lockTenant(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:commercial-seat-allocation`}, 0)
    )
  `;
  await transaction.$queryRaw`
    SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
  `;
}

async function assertAnotherActiveAdministrator(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  excludedUserId: string,
): Promise<void> {
  const count = await transaction.user.count({
    where: {
      tenantId,
      id: { not: excludedUserId },
      status: 'ACTIVE',
      userRoles: {
        some: { role: { isSystem: true, name: 'Administrator' } },
      },
    },
  });
  if (count === 0) {
    throw new ApplicationError(
      ErrorCode.LastAdministratorRequired,
      'The organization must retain at least one active administrator.',
      HttpStatus.CONFLICT,
    );
  }
}

function hasAdministratorRole(user: UserWithRoles): boolean {
  return user.userRoles.some(
    ({ role }) => role.isSystem && role.name === 'Administrator',
  );
}

function mapUser(user: UserWithRoles): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    roles: user.userRoles.map(({ role }) => ({
      id: role.id,
      name: role.name,
      isSystem: role.isSystem,
    })),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function userNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.NotFound,
    'The requested user was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function roleInvalid(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RoleInvalid,
    'One or more roles are invalid.',
    HttpStatus.BAD_REQUEST,
  );
}
