import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  CreateRoleDto,
  RoleListQueryDto,
  UpdateRoleDto,
} from '../application/dto/role-request.dto.js';
import {
  PermissionResponseDto,
  RoleResponseDto,
} from '../application/dto/role-response.dto.js';
import { RolesService } from '../application/roles.service.js';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions('roles.read')
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: RoleListQueryDto,
  ): Promise<RoleResponseDto[]> {
    return this.roles.list(principal, query.limit);
  }

  @Get('permissions')
  @Permissions('roles.read')
  @ApiOkResponse({ type: PermissionResponseDto, isArray: true })
  listPermissions(): Promise<PermissionResponseDto[]> {
    return this.roles.listPermissions();
  }

  @Post()
  @Permissions('roles.create', 'roles.assign')
  @ApiCreatedResponse({ type: RoleResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateRoleDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RoleResponseDto> {
    return this.roles.create(principal, input, requestMetadata(request));
  }

  @Patch(':roleId')
  @Permissions('roles.update', 'roles.assign')
  @ApiOkResponse({ type: RoleResponseDto })
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @Body() input: UpdateRoleDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RoleResponseDto> {
    return this.roles.update(
      principal,
      roleId,
      input,
      requestMetadata(request),
    );
  }
}

function requestMetadata(
  request: Request & RequestWithContext,
): RequestMetadata {
  return {
    correlationId: request.correlationId,
    ipAddress: request.ip,
    userAgent: request.header('user-agent'),
  };
}
