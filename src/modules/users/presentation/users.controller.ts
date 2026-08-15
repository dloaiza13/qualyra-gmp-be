import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  UpdateUserRolesDto,
  UpdateUserStatusDto,
} from '../application/dto/user-request.dto.js';
import { UserResponseDto } from '../application/dto/user-response.dto.js';
import { UsersService } from '../application/users.service.js';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('users.read')
  @ApiOkResponse({ type: UserResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<UserResponseDto[]> {
    return this.users.list(principal);
  }

  @Get(':userId')
  @Permissions('users.read')
  @ApiOkResponse({ type: UserResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<UserResponseDto> {
    return this.users.get(principal, userId);
  }

  @Patch(':userId/status')
  @Permissions('users.change_status')
  @ApiOkResponse({ type: UserResponseDto })
  updateStatus(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateUserStatusDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<UserResponseDto> {
    return this.users.updateStatus(
      principal,
      userId,
      input,
      requestMetadata(request),
    );
  }

  @Patch(':userId/roles')
  @Permissions('users.assign_roles', 'roles.assign')
  @ApiOkResponse({ type: UserResponseDto })
  updateRoles(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateUserRolesDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<UserResponseDto> {
    return this.users.updateRoles(
      principal,
      userId,
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
