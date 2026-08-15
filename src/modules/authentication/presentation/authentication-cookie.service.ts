import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Environment } from '../../../common/config/environment.js';

@Injectable()
export class AuthenticationCookieService {
  readonly refreshCookieName: string;
  readonly csrfCookieName: string;
  private readonly options: CookieOptions;
  private readonly clearOptions: CookieOptions;

  constructor(configService: ConfigService<Environment, true>) {
    const secure = configService.getOrThrow('COOKIE_SECURE', { infer: true });
    this.refreshCookieName = configService.getOrThrow('COOKIE_NAME', {
      infer: true,
    });
    this.csrfCookieName = configService.getOrThrow('CSRF_COOKIE_NAME', {
      infer: true,
    });
    const refreshTokenTtlDays = configService.getOrThrow(
      'REFRESH_TOKEN_TTL_DAYS',
      { infer: true },
    );
    this.clearOptions = {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
    };
    this.options = {
      ...this.clearOptions,
      maxAge: refreshTokenTtlDays * 24 * 60 * 60 * 1_000,
    };
  }

  set(response: Response, refreshToken: string, csrfToken: string): void {
    response.cookie(this.refreshCookieName, refreshToken, this.options);
    response.cookie(this.csrfCookieName, csrfToken, {
      ...this.options,
      httpOnly: false,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.refreshCookieName, this.clearOptions);
    response.clearCookie(this.csrfCookieName, {
      ...this.clearOptions,
      httpOnly: false,
    });
  }

  readRefreshToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[this.refreshCookieName];
    return typeof value === 'string' ? value : undefined;
  }
}
