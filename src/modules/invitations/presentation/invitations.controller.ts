import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { AuthenticationResponseDto } from '../../authentication/application/dto/auth-response.dto.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { AuthenticationCookieService } from '../../authentication/presentation/authentication-cookie.service.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationTokenDto,
} from '../application/dto/invitation-request.dto.js';
import {
  InvitationPreviewDto,
  InvitationResponseDto,
} from '../application/dto/invitation-response.dto.js';
import { InvitationsService } from '../application/invitations.service.js';

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users/invitations')
export class UserInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @Permissions('users.invite', 'roles.assign')
  @ApiCreatedResponse({ type: InvitationResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateInvitationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<InvitationResponseDto> {
    return this.invitations.create(principal, input, requestMetadata(request));
  }

  @Get()
  @Permissions('users.read')
  @ApiOkResponse({ type: InvitationResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<InvitationResponseDto[]> {
    return this.invitations.list(principal);
  }

  @Post(':invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @Permissions('users.invite')
  @ApiOkResponse({ type: InvitationResponseDto })
  resend(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<InvitationResponseDto> {
    return this.invitations.resend(
      principal,
      invitationId,
      requestMetadata(request),
    );
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('users.invite')
  @ApiNoContentResponse()
  revoke(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<void> {
    return this.invitations.revoke(
      principal,
      invitationId,
      requestMetadata(request),
    );
  }
}

@ApiTags('Invitations')
@Controller('invitations')
export class PublicInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: AuthenticationCookieService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ type: InvitationPreviewDto })
  preview(@Body() input: InvitationTokenDto): Promise<InvitationPreviewDto> {
    return this.invitations.preview(input);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthenticationResponseDto })
  async accept(
    @Body() input: AcceptInvitationDto,
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponseDto> {
    const result = await this.invitations.accept(
      input,
      requestMetadata(request),
    );
    this.cookies.set(response, result.refreshToken, result.csrfToken);
    return result.response;
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
