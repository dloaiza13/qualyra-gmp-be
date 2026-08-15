import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  parseAllowedOrigins,
  type Environment,
} from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { AuthenticationCookieService } from './authentication-cookie.service.js';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    configService: ConfigService<Environment, true>,
    private readonly cookies: AuthenticationCookieService,
  ) {
    this.allowedOrigins = new Set(
      parseAllowedOrigins(
        configService.getOrThrow('CORS_ALLOWED_ORIGINS', { infer: true }),
      ),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = resolveOrigin(request);
    const headerToken = request.header('x-csrf-token');
    const cookieValues = request.cookies as Record<string, unknown> | undefined;
    const cookieToken = cookieValues?.[this.cookies.csrfCookieName];

    if (
      !origin ||
      !this.allowedOrigins.has(origin) ||
      typeof headerToken !== 'string' ||
      typeof cookieToken !== 'string' ||
      !safeEqual(headerToken, cookieToken)
    ) {
      throw new ApplicationError(
        ErrorCode.Forbidden,
        'The request could not be verified.',
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}

function resolveOrigin(request: Request): string | undefined {
  const origin = request.header('origin');
  if (origin) return origin;

  const referer = request.header('referer');
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
