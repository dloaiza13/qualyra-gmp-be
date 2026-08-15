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
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import { AuthenticationService } from '../application/authentication.service.js';
import {
  AuthenticationResponseDto,
  MeResponseDto,
  NeutralResponseDto,
  SessionResponseDto,
} from '../application/dto/auth-response.dto.js';
import {
  LoginDto,
  RegisterCompanyDto,
  ResetPasswordDto,
  TenantEmailDto,
  TokenDto,
} from '../application/dto/auth-request.dto.js';
import type { RequestMetadata } from '../application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal.js';
import { AuthenticationCookieService } from './authentication-cookie.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { CurrentPrincipal } from './current-principal.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly cookies: AuthenticationCookieService,
  ) {}

  @Post('register-company')
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    identity: { limit: 5, ttl: 60_000 },
  })
  @ApiCreatedResponse({ type: AuthenticationResponseDto })
  async registerCompany(
    @Body() input: RegisterCompanyDto,
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponseDto> {
    const result = await this.authentication.registerCompany(
      input,
      requestMetadata(request),
    );
    this.cookies.set(response, result.refreshToken, result.csrfToken);
    return result.response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 10, ttl: 60_000 },
    identity: { limit: 10, ttl: 60_000 },
  })
  @ApiOkResponse({ type: AuthenticationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Credentials are invalid.' })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponseDto> {
    const result = await this.authentication.login(
      input,
      requestMetadata(request),
    );
    this.cookies.set(response, result.refreshToken, result.csrfToken);
    return result.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiCookieAuth('qualyra_refresh')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: AuthenticationResponseDto })
  async refresh(
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponseDto> {
    const refreshToken = this.cookies.readRefreshToken(request);
    try {
      const result = await this.authentication.refresh(
        refreshToken ?? '',
        requestMetadata(request),
      );
      this.cookies.set(response, result.refreshToken, result.csrfToken);
      return result.response;
    } catch (error: unknown) {
      this.cookies.clear(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CsrfGuard)
  @ApiCookieAuth('qualyra_refresh')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiNoContentResponse()
  async logout(
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authentication.logout(
      this.cookies.readRefreshToken(request),
      requestMetadata(request),
    );
    this.cookies.clear(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth()
  @ApiCookieAuth('qualyra_refresh')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiNoContentResponse()
  async logoutAll(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authentication.logoutAll(principal, requestMetadata(request));
    this.cookies.clear(response);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: MeResponseDto })
  getMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MeResponseDto> {
    return this.authentication.getMe(principal);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  listSessions(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<SessionResponseDto[]> {
    return this.authentication.listSessions(principal);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  revokeSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<void> {
    return this.authentication.revokeSession(
      principal,
      sessionId,
      requestMetadata(request),
    );
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    identity: { limit: 5, ttl: 60_000 },
  })
  @ApiOkResponse({ type: NeutralResponseDto })
  async forgotPassword(
    @Body() input: TenantEmailDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<NeutralResponseDto> {
    await this.authentication.forgotPassword(input, requestMetadata(request));
    return { accepted: true };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: NeutralResponseDto })
  async resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<NeutralResponseDto> {
    await this.authentication.resetPassword(input, requestMetadata(request));
    return { accepted: true };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: NeutralResponseDto })
  async verifyEmail(
    @Body() input: TokenDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<NeutralResponseDto> {
    await this.authentication.verifyEmail(input, requestMetadata(request));
    return { accepted: true };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    identity: { limit: 5, ttl: 60_000 },
  })
  @ApiOkResponse({ type: NeutralResponseDto })
  async resendVerification(
    @Body() input: TenantEmailDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<NeutralResponseDto> {
    await this.authentication.resendVerification(
      input,
      requestMetadata(request),
    );
    return { accepted: true };
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
