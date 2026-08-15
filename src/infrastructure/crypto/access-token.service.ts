import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Environment } from '../../common/config/environment.js';
import type { AuthenticatedPrincipal } from '../../modules/authentication/domain/authenticated-principal.js';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  sessionId: string;
  tokenVersion: number;
  jti: string;
  iat?: number;
  exp?: number;
}

const accessTokenPayloadSchema = z.object({
  sub: z.uuid(),
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  tokenVersion: z.number().int().nonnegative(),
  jti: z.uuid(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});

@Injectable()
export class AccessTokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly expiresIn: JwtSignOptions['expiresIn'];

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService<Environment, true>,
  ) {
    this.privateKey = readKey(
      configService.getOrThrow('JWT_ACCESS_PRIVATE_KEY', { infer: true }),
    );
    this.publicKey = readKey(
      configService.getOrThrow('JWT_ACCESS_PUBLIC_KEY', { infer: true }),
    );
    this.issuer = configService.getOrThrow('JWT_ISSUER', { infer: true });
    this.audience = configService.getOrThrow('JWT_AUDIENCE', { infer: true });
    this.expiresIn = configService.getOrThrow('JWT_ACCESS_TTL', {
      infer: true,
    });
  }

  sign(principal: AuthenticatedPrincipal): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: principal.userId,
      tenantId: principal.tenantId,
      sessionId: principal.sessionId,
      tokenVersion: principal.tokenVersion,
      jti: randomUUID(),
    };

    return this.jwtService.signAsync(payload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: this.expiresIn,
    });
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const untrustedPayload = await this.jwtService.verifyAsync<
      Record<string, unknown>
    >(token, {
      algorithms: ['RS256'],
      publicKey: this.publicKey,
      issuer: this.issuer,
      audience: this.audience,
    });
    const payload = accessTokenPayloadSchema.parse(untrustedPayload);

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      tokenVersion: payload.tokenVersion,
    };
  }
}

function readKey(value: string): string {
  if (value.startsWith('file:')) {
    return readFileSync(resolve(value.slice('file:'.length)), 'utf8');
  }
  return value.replaceAll('\\n', '\n');
}
