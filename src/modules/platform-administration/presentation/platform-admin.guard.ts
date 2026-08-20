import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly expectedDigest: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    this.enabled = config.getOrThrow('PLATFORM_ADMIN_ENABLED', {
      infer: true,
    });
    this.expectedDigest = digest(
      config.getOrThrow('PLATFORM_ADMIN_BEARER_TOKEN', { infer: true }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) {
      throw new ApplicationError(
        ErrorCode.NotFound,
        'The requested resource was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!timingSafeEqual(this.expectedDigest, digest(token))) {
      throw new ApplicationError(
        ErrorCode.Unauthorized,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
