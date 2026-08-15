import { HttpStatus, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role-request.dto.js';
import type {
  PermissionResponseDto,
  RoleResponseDto,
} from './dto/role-response.dto.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
  ) {}

  list(
    principal: AuthenticatedPrincipal,
    limit: number,
  ): Promise<RoleResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const roles = await transaction.role.findMany({
          where: { tenantId: principal.tenantId },
          take: Math.min(Math.max(limit, 1), 200),
          orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
          include: {
            rolePermissions: {
              include: { permission: true },
              orderBy: { permission: { code: 'asc' } },
            },
            _count: { select: { userRoles: true } },
          },
        });
        return roles.map(mapRole);
      },
    );
  }

  async listPermissions(): Promise<PermissionResponseDto[]> {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateRoleDto,
    request: RequestMetadata,
  ): Promise<RoleResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const permissions = await transaction.permission.findMany({
          where: { id: { in: input.permissionIds } },
          select: { id: true },
        });
        if (permissions.length !== input.permissionIds.length) {
          throw roleInvalid();
        }
        try {
          const role = await transaction.role.create({
            data: {
              tenantId: principal.tenantId,
              name: input.name,
              description: input.description,
              rolePermissions: {
                create: permissions.map(({ id: permissionId }) => ({
                  permissionId,
                })),
              },
            },
            include: {
              rolePermissions: { include: { permission: true } },
              _count: { select: { userRoles: true } },
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'ROLE_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: { roleId: role.id },
          });
          return mapRole(role);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw roleNameExists();
          throw error;
        }
      },
    );
  }

  update(
    principal: AuthenticatedPrincipal,
    roleId: string,
    input: UpdateRoleDto,
    request: RequestMetadata,
  ): Promise<RoleResponseDto> {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.permissionIds === undefined
    ) {
      throw new ApplicationError(
        ErrorCode.ValidationError,
        'At least one role field is required.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const existing = await transaction.role.findFirst({
          where: { id: roleId, tenantId: principal.tenantId },
          select: { id: true, name: true, isSystem: true },
        });
        if (!existing) throw roleInvalid();
        if (existing.isSystem && input.name && input.name !== existing.name) {
          throw new ApplicationError(
            ErrorCode.Forbidden,
            'System role names cannot be changed.',
            HttpStatus.FORBIDDEN,
          );
        }
        if (
          existing.isSystem &&
          existing.name === 'Administrator' &&
          input.permissionIds !== undefined
        ) {
          throw new ApplicationError(
            ErrorCode.Forbidden,
            'Administrator permissions cannot be reduced.',
            HttpStatus.FORBIDDEN,
          );
        }

        let permissionIds = input.permissionIds;
        if (permissionIds) {
          const permissions = await transaction.permission.findMany({
            where: { id: { in: permissionIds } },
            select: { id: true },
          });
          if (permissions.length !== permissionIds.length) throw roleInvalid();
          permissionIds = permissions.map(({ id }) => id);
        }

        try {
          if (permissionIds) {
            await transaction.rolePermission.deleteMany({
              where: { tenantId: principal.tenantId, roleId },
            });
            await transaction.rolePermission.createMany({
              data: permissionIds.map((permissionId) => ({
                tenantId: principal.tenantId,
                roleId,
                permissionId,
              })),
            });
          }
          const role = await transaction.role.update({
            where: { id: roleId },
            data: {
              name: input.name,
              description: input.description,
            },
            include: {
              rolePermissions: { include: { permission: true } },
              _count: { select: { userRoles: true } },
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'ROLE_UPDATED',
            outcome: 'SUCCESS',
            request,
            metadata: { roleId },
          });
          return mapRole(role);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw roleNameExists();
          throw error;
        }
      },
    );
  }
}

function mapRole(role: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions: { permission: PermissionResponseDto }[];
  _count: { userRoles: number };
}): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.rolePermissions
      .map(({ permission }) => permission)
      .sort((left, right) => left.code.localeCompare(right.code)),
    userCount: role._count.userRoles,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function roleInvalid(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RoleInvalid,
    'One or more roles or permissions are invalid.',
    HttpStatus.BAD_REQUEST,
  );
}

function roleNameExists(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RoleNameExists,
    'A role with this name already exists.',
    HttpStatus.CONFLICT,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}
